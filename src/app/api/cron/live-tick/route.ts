import { NextRequest, NextResponse } from "next/server";
import { Client as QStashClient } from "@upstash/qstash";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getEspnScoreboard, getEspnMatchEvents, ESPN_LEAGUE_SLUG } from "@/lib/espn/client";
import { teamNamesMatch, matchPlayerByName } from "@/lib/sync/name-match";
import { sendPushBroadcastWithOverrides } from "@/lib/push/server";
import { SYSTEM_SENDER_NAME } from "@/lib/system-sender";
import { loadPointConfig, processFinishedMatches, type ServiceClient } from "@/app/api/cron/process-scoring/route";

// Durée max raisonnable d'un match + arrêts de jeu : au-delà, un match "scheduled"/"live" en base
// sort de la fenêtre de suivi minute par minute et retombe sur le filet de sécurité (sync-fixtures
// + process-scoring, toutes les 30 min) plutôt que d'être interrogé indéfiniment.
const LIVE_WINDOW_MS = 150 * 60 * 1000;

const APP_URL = "https://bootroom.online";

// QStash ne planifie pas plus finement que la minute (syntaxe cron standard) : le schedule
// "* * * * *" est déjà le maximum. Pour se rapprocher davantage du direct pendant qu'un match est
// réellement en cours, ce tick s'auto-replanifie 3 fois dans la minute qui suit (toutes les 15s)
// via un message QStash à retardement — repli sur le rythme normal (60s) dès qu'aucun match n'est
// live, pour ne pas payer ce surcoût le reste du temps (le point du filtre "fenêtre" en haut).
const FOLLOWUP_DELAYS_SECONDS = [15, 30, 45];

async function scheduleFollowUpTicks(): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  if (!token || !cronSecret) return;

  const client = new QStashClient({ token });
  await Promise.all(
    FOLLOWUP_DELAYS_SECONDS.map((delay) =>
      client.publish({
        url: `${APP_URL}/api/cron/live-tick`,
        method: "GET",
        headers: { Authorization: `Bearer ${cronSecret}` },
        delay,
        // Un tick de suivi par tranche de 15s de la même minute, pas un par appel : deux
        // exécutions du cron régulier qui se chevaucheraient (peu probable mais pas exclu)
        // ne doivent pas empiler leurs relances respectives.
        deduplicationId: `bootroom-live-tick-followup-${Math.floor(Date.now() / 60_000)}-${delay}`,
      })
    )
  );
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - LIVE_WINDOW_MS).toISOString();

  const { data: inWindowMatches } = await supabase
    .from("matches")
    .select("id, league_id, season_id, home_team_id, away_team_id, status, home_score, away_score, kickoff_at, favorite_team_id, odds_tier")
    .in("status", ["scheduled", "live"])
    .lte("kickoff_at", now.toISOString())
    .gt("kickoff_at", windowStart);

  // Rien à faire tant qu'aucun match suivi n'est en train de se jouer : sortir avant le moindre
  // appel ESPN, pour que ce cron (déclenché toutes les minutes) ne coûte quasiment rien le reste
  // du temps.
  if (!inWindowMatches || inWindowMatches.length === 0) {
    return NextResponse.json({ inWindow: 0 });
  }

  const [{ data: leagues }, { data: teams }] = await Promise.all([
    supabase.from("leagues").select("id, football_data_code").in("id", [...new Set(inWindowMatches.map((m) => m.league_id))]),
    supabase.from("teams").select("id, name").in("id", [...new Set(inWindowMatches.flatMap((m) => [m.home_team_id, m.away_team_id]))]),
  ]);
  const slugByLeague = new Map((leagues ?? []).map((l) => [l.id, ESPN_LEAGUE_SLUG[l.football_data_code]]));
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  const scoreboardCache = new Map<string, Awaited<ReturnType<typeof getEspnScoreboard>> | null>();
  const newlyFinishedMatchIds: number[] = [];
  const goalPushJobs: Array<() => Promise<void>> = [];
  let liveCount = 0;
  let updatedCount = 0;

  for (const match of inWindowMatches) {
    const slug = slugByLeague.get(match.league_id);
    const home = teamById.get(match.home_team_id);
    const away = teamById.get(match.away_team_id);
    if (!slug || !home || !away) continue;

    const ymd = match.kickoff_at.slice(0, 10).replace(/-/g, "");
    const cacheKey = `${slug}|${ymd}`;
    let dayEvents = scoreboardCache.get(cacheKey);
    if (dayEvents === undefined) {
      try {
        dayEvents = await getEspnScoreboard(slug, ymd, ymd);
      } catch {
        dayEvents = null;
      }
      scoreboardCache.set(cacheKey, dayEvents);
    }
    if (!dayEvents) continue;

    const espnMatch = dayEvents.find((e) => teamNamesMatch(e.homeTeam, home.name) && teamNamesMatch(e.awayTeam, away.name));
    if (!espnMatch || espnMatch.status === "scheduled") continue;

    if (espnMatch.status === "live") liveCount++;
    const justFinished = match.status !== "finished" && espnMatch.status === "finished";

    const scoreOrStatusChanged =
      espnMatch.status !== match.status || espnMatch.homeScore !== match.home_score || espnMatch.awayScore !== match.away_score;
    if (scoreOrStatusChanged || espnMatch.status === "live") {
      await supabase
        .from("matches")
        .update({
          status: espnMatch.status,
          home_score: espnMatch.homeScore,
          away_score: espnMatch.awayScore,
          live_clock: espnMatch.status === "live" ? espnMatch.displayClock : null,
        })
        .eq("id", match.id);
      updatedCount++;
    }

    // Buts : uniquement pour un match en cours ou qui vient de se terminer (rien à récupérer pour
    // un match qui n'a pas encore commencé, déjà filtré ci-dessus).
    if (espnMatch.status === "live" || espnMatch.status === "finished") {
      const [{ data: existingGoals }, { data: existingSubs }] = await Promise.all([
        supabase.from("match_goals").select("player_id, assist_player_id, minute").eq("match_id", match.id),
        supabase.from("match_substitutions").select("player_out_id, player_in_id").eq("match_id", match.id),
      ]);
      const existingKeys = new Set((existingGoals ?? []).map((g) => `${g.player_id}:${g.minute}`));
      const existingSubKeys = new Set((existingSubs ?? []).map((s) => `${s.player_out_id}:${s.player_in_id}`));

      let goals: Awaited<ReturnType<typeof getEspnMatchEvents>>["goals"] = [];
      let substitutions: Awaited<ReturnType<typeof getEspnMatchEvents>>["substitutions"] = [];
      try {
        const events = await getEspnMatchEvents(slug, espnMatch.id);
        goals = events.goals;
        substitutions = events.substitutions;
      } catch {
        // ESPN indisponible pour ce match précis : rien à mettre à jour ce tick-ci, le prochain
        // passage (dans la minute) réessaiera — pas la peine de faire échouer tout le cron pour ça.
      }

      const homePlayers = (await supabase.from("players").select("id, name").eq("team_id", match.home_team_id).is("left_at", null)).data ?? [];
      const awayPlayers = (await supabase.from("players").select("id, name").eq("team_id", match.away_team_id).is("left_at", null)).data ?? [];

      const newSubRows = substitutions.flatMap((s) => {
        const teamId = teamNamesMatch(s.teamName, home.name) ? match.home_team_id : match.away_team_id;
        const candidates = teamId === match.home_team_id ? homePlayers : awayPlayers;
        const playerOut = matchPlayerByName(s.playerOutName, candidates);
        const playerIn = matchPlayerByName(s.playerInName, candidates);
        if (!playerOut && !playerIn) return [];
        const key = `${playerOut?.id ?? null}:${playerIn?.id ?? null}`;
        if (existingSubKeys.has(key)) return [];
        return [{ match_id: match.id, team_id: teamId, player_out_id: playerOut?.id ?? null, player_in_id: playerIn?.id ?? null, minute: s.minute }];
      });
      if (newSubRows.length > 0) {
        await supabase.from("match_substitutions").insert(newSubRows);
      }

      const newGoalRows = goals.flatMap((g) => {
        const teamId = teamNamesMatch(g.teamName, home.name) ? match.home_team_id : match.away_team_id;
        const candidates = teamId === match.home_team_id ? homePlayers : awayPlayers;
        const scorer = matchPlayerByName(g.scorerName, candidates);
        if (!scorer) return [];
        const key = `${scorer.id}:${g.minute}`;
        if (existingKeys.has(key)) return [];
        const assist = g.assistName ? matchPlayerByName(g.assistName, candidates) : null;
        return [{ match_id: match.id, team_id: teamId, player_id: scorer.id, assist_player_id: assist?.id ?? null, minute: g.minute, scorerName: scorer.name }];
      });

      if (newGoalRows.length > 0) {
        await supabase.from("match_goals").insert(
          newGoalRows.map((row) => ({
            match_id: row.match_id,
            team_id: row.team_id,
            player_id: row.player_id,
            assist_player_id: row.assist_player_id,
            minute: row.minute,
          }))
        );
        // "Garantie buteur/passeur" (voir process-scoring) : le remplaçant entré à la place du
        // joueur pronostiqué compte aussi, y compris pour la notif temps réel — pas seulement au
        // calcul des points a posteriori.
        const playerInToOut = new Map<number, number>();
        for (const s of [...(existingSubs ?? []), ...newSubRows]) {
          if (s.player_in_id != null && s.player_out_id != null) playerInToOut.set(s.player_in_id, s.player_out_id);
        }
        for (const goal of newGoalRows) {
          goalPushJobs.push(() =>
            notifyGoal(supabase, match, home.name, away.name, espnMatch.homeScore ?? 0, espnMatch.awayScore ?? 0, goal, playerInToOut)
          );
        }
      }

      if (espnMatch.status === "finished") {
        await supabase.from("matches").update({ events_synced_at: new Date().toISOString() }).eq("id", match.id).is("events_synced_at", null);
      }
    }

    if (justFinished) newlyFinishedMatchIds.push(match.id);
  }

  // Envoyer les notifs de but APRÈS avoir bouclé sur tous les matchs (pas d'impact sur le timing
  // de mise à jour du score lui-même, qui doit rester la priorité de chaque itération).
  await Promise.all(goalPushJobs.map((job) => job()));

  let scoredMatches = 0;
  if (newlyFinishedMatchIds.length > 0) {
    const config = await loadPointConfig(supabase);
    const result = await processFinishedMatches(supabase, config, newlyFinishedMatchIds);
    scoredMatches = result.processed ?? 0;
    await notifyFinalResults(supabase, newlyFinishedMatchIds, teamById);
  }

  if (liveCount > 0) {
    try {
      await scheduleFollowUpTicks();
    } catch {
      // Pas grave : le prochain tick régulier (dans la minute) reprendra la main normalement.
    }
  }

  return NextResponse.json({
    inWindow: inWindowMatches.length,
    live: liveCount,
    updated: updatedCount,
    goalsNotified: goalPushJobs.length,
    newlyFinished: newlyFinishedMatchIds.length,
    scoredMatches,
  });
}

interface NewGoal {
  match_id: number;
  team_id: number;
  player_id: number;
  assist_player_id: number | null;
  minute: number | null;
  scorerName: string;
}

async function notifyGoal(
  supabase: ServiceClient,
  match: { id: number; home_team_id: number; away_team_id: number },
  homeName: string,
  awayName: string,
  homeScore: number,
  awayScore: number,
  goal: NewGoal,
  playerInToOut: Map<number, number>
): Promise<void> {
  const { data: predictions } = await supabase
    .from("match_predictions")
    .select("user_id, predicted_scorer_player_id, predicted_assist_player_id")
    .eq("match_id", match.id);

  const minuteLabel = goal.minute != null ? ` (${goal.minute}')` : "";
  const fallback = {
    title: SYSTEM_SENDER_NAME,
    body: `⚽ But ! ${homeName} ${homeScore} - ${awayScore} ${awayName} — ${goal.scorerName}${minuteLabel}`,
    url: `${APP_URL}/calendar`,
  };

  // Garantie buteur/passeur : un pronostic sur le joueur remplacé compte aussi si c'est son
  // remplaçant qui marque/passe à sa place (voir process-scoring pour le calcul définitif après
  // coup — cette notif temps réel applique la même règle).
  const scorerReplacedFor = playerInToOut.get(goal.player_id);
  const assistReplacedFor = goal.assist_player_id != null ? playerInToOut.get(goal.assist_player_id) : undefined;

  const overrides = new Map<string, { title: string; body: string; url?: string }>();
  for (const pred of predictions ?? []) {
    const scorerHit =
      pred.predicted_scorer_player_id === goal.player_id || pred.predicted_scorer_player_id === scorerReplacedFor;
    const assistHit =
      goal.assist_player_id != null &&
      (pred.predicted_assist_player_id === goal.assist_player_id || pred.predicted_assist_player_id === assistReplacedFor);
    if (scorerHit || assistHit) {
      const bonus = scorerHit && assistHit ? "Buteur ET passeur trouvés, énorme 🔥" : scorerHit ? "Ton pronostic buteur est bon 🎯" : "Ton pronostic passeur est bon 🎯";
      overrides.set(pred.user_id, { ...fallback, body: `${fallback.body}\n${bonus}` });
    }
  }

  await sendPushBroadcastWithOverrides(overrides, fallback);
}

async function notifyFinalResults(
  supabase: ServiceClient,
  matchIds: number[],
  teamById: Map<number, { id: number; name: string }>
): Promise<void> {
  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, away_score")
    .in("id", matchIds);

  for (const match of matches ?? []) {
    const home = teamById.get(match.home_team_id);
    const away = teamById.get(match.away_team_id);
    if (!home || !away) continue;

    const { data: predictions } = await supabase
      .from("match_predictions")
      .select("user_id, points_awarded")
      .eq("match_id", match.id);

    const fallback = {
      title: SYSTEM_SENDER_NAME,
      body: `🏁 Match terminé : ${home.name} ${match.home_score} - ${match.away_score} ${away.name}`,
      url: `${APP_URL}/calendar`,
    };
    const overrides = new Map<string, { title: string; body: string; url?: string }>();
    for (const pred of predictions ?? []) {
      if (pred.points_awarded && pred.points_awarded > 0) {
        overrides.set(pred.user_id, { ...fallback, body: `${fallback.body}\n+${pred.points_awarded} pts pour toi !` });
      }
    }
    await sendPushBroadcastWithOverrides(overrides, fallback);
  }
}
