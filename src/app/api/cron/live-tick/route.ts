import { NextRequest, NextResponse } from "next/server";
import { Client as QStashClient } from "@upstash/qstash";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getEspnScoreboard, getEspnMatchEvents, ESPN_LEAGUE_SLUG } from "@/lib/espn/client";
import { teamNamesMatch, matchPlayerByName, goalKey } from "@/lib/sync/name-match";
import { sendPushBroadcastWithOverrides, sendPushToUserIdsWithOverrides } from "@/lib/push/server";
import { SYSTEM_SENDER_NAME } from "@/lib/system-sender";
import { loadPointConfig, processFinishedMatches, type ServiceClient } from "@/app/api/cron/process-scoring/route";

// Durée max raisonnable d'un match + arrêts de jeu : au-delà, un match "scheduled"/"live" en base
// sort de la fenêtre de suivi minute par minute et retombe sur le filet de sécurité (sync-fixtures
// + process-scoring, toutes les 30 min) plutôt que d'être interrogé indéfiniment.
const LIVE_WINDOW_MS = 150 * 60 * 1000;
// Anticipe un coup d'envoi à venir : sans ça, ce tick ne remarque un match qu'une fois son
// kickoff_at déjà passé — la chaîne démarre maintenant quelques minutes AVANT le coup d'envoi réel
// (réveillée par sync-fixtures, voir plus bas), déjà "chaude" au moment où le match démarre pour
// de vrai plutôt que de le découvrir avec du retard.
const LOOKAHEAD_MS = 5 * 60 * 1000;

const APP_URL = "https://bootroom.online";

// Pas de schedule QStash fixe pour ce cron (voir incident du 10/09/2026 : "* * * * *" en continu,
// 1440 messages/jour rien que pour ce tick, a fait exploser le quota gratuit QStash de 1000
// messages/jour en pleine soirée de Ligue des Champions — plus aucun cron n'a tourné du tout,
// scores/temps de jeu figés toute la soirée). Ce tick s'auto-réveille désormais lui-même : chaque
// exécution qui trouve encore un match à suivre (pas encore terminé) programme la suivante via un
// message QStash à retardement, court (20s) tant qu'un match est réellement en direct, plus large
// (60s) sinon (avant coup d'envoi, ou ESPN pas encore à jour) — et s'arrête d'elle-même dès qu'il
// n'y a plus rien à suivre. Le réveil initial (avant tout coup d'envoi) est délégué à sync-fixtures
// (toutes les 30 min, anticipation de 35 min — supérieure à son propre intervalle, aucun coup
// d'envoi ne peut donc jamais passer entre deux réveils sans qu'une chaîne ne soit déjà en cours).
const LIVE_TICK_DELAY_SECONDS = 20;
const WARMUP_TICK_DELAY_SECONDS = 60;

async function scheduleNextTick(delaySeconds: number): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  if (!token || !cronSecret) return;

  const client = new QStashClient({ token });
  await client.publish({
    url: `${APP_URL}/api/cron/live-tick`,
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
    delay: delaySeconds,
  });
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - LIVE_WINDOW_MS).toISOString();
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_MS).toISOString();

  const { data: inWindowMatches } = await supabase
    .from("matches")
    .select("id, league_id, season_id, home_team_id, away_team_id, status, home_score, away_score, kickoff_at, favorite_team_id, odds_tier")
    .in("status", ["scheduled", "live"])
    .lte("kickoff_at", windowEnd)
    .gt("kickoff_at", windowStart);

  // Rien à faire (et rien à re-planifier, voir scheduleNextTick plus bas) : sortir avant le moindre
  // appel ESPN.
  if (!inWindowMatches || inWindowMatches.length === 0) {
    return NextResponse.json({ inWindow: 0, pending: 0 });
  }

  const [{ data: leagues }, { data: teams }] = await Promise.all([
    // .eq("active", true) : un championnat désactivé (Bundesliga, Primeira Liga) garde ses matchs
    // en base mais ne doit plus être suivi minute par minute — absent d'ici, son league_id ne
    // matchera rien dans slugByLeague juste en dessous, et la boucle le sautera via le "!slug"
    // déjà en place, sans code de filtrage séparé à maintenir.
    supabase
      .from("leagues")
      .select("id, football_data_code")
      .eq("active", true)
      .in("id", [...new Set(inWindowMatches.map((m) => m.league_id))]),
    supabase.from("teams").select("id, name").in("id", [...new Set(inWindowMatches.flatMap((m) => [m.home_team_id, m.away_team_id]))]),
  ]);
  const slugByLeague = new Map((leagues ?? []).map((l) => [l.id, ESPN_LEAGUE_SLUG[l.football_data_code]]));
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  const scoreboardCache = new Map<string, Awaited<ReturnType<typeof getEspnScoreboard>> | null>();
  const newlyFinishedMatchIds: number[] = [];
  const goalPushJobs: Array<() => Promise<void>> = [];
  let liveCount = 0;
  let updatedCount = 0;
  // Piloté la chaîne d'auto-réveil (voir scheduleNextTick) : incrémenté pour tout match d'un
  // championnat suivi qui n'est pas encore confirmé "finished" — pas encore commencé, en cours, ou
  // ESPN pas encore à jour ce tick-ci (retenter au prochain). Reste à 0 (donc chaîne arrêtée) si
  // tous les matchs suivis sont soit terminés, soit d'un championnat désactivé.
  let pendingCount = 0;

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
    if (!dayEvents) {
      pendingCount++; // ESPN indisponible ce tick-ci : à retenter, pas une fin de suivi.
      continue;
    }

    const espnMatch = dayEvents.find((e) => teamNamesMatch(e.homeTeam, home.name) && teamNamesMatch(e.awayTeam, away.name));
    if (!espnMatch || espnMatch.status === "scheduled") {
      pendingCount++; // Pas encore commencé (ou pas encore listé par ESPN) : à retenter.
      continue;
    }

    if (espnMatch.status === "live") {
      liveCount++;
      pendingCount++;
    }
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
        supabase
          .from("match_goals")
          .select("id, player_id, assist_player_id, assist_name, minute, scorer_name")
          .eq("match_id", match.id),
        supabase.from("match_substitutions").select("player_out_id, player_in_id").eq("match_id", match.id),
      ]);
      const existingGoalByKey = new Map((existingGoals ?? []).map((g) => [goalKey(g.player_id, g.scorer_name, g.minute), g]));
      const existingKeys = new Set(existingGoalByKey.keys());
      const existingSubKeys = new Set((existingSubs ?? []).map((s) => `${s.player_out_id}:${s.player_in_id}`));

      let goals: Awaited<ReturnType<typeof getEspnMatchEvents>>["goals"] = [];
      let substitutions: Awaited<ReturnType<typeof getEspnMatchEvents>>["substitutions"] = [];
      // Distingue "ESPN indisponible ce tick-ci" (goals reste [], mais ne rien en déduire) de
      // "ESPN a répondu, et cette liste fait foi" (fetchSucceeded) : sans cette distinction, un
      // simple échec réseau ponctuel se lirait comme "plus aucun but" et effacerait tout ce qui a
      // déjà été enregistré pour ce match — voir la réconciliation des buts annulés plus bas.
      let fetchSucceeded = false;
      try {
        const events = await getEspnMatchEvents(slug, espnMatch.id);
        goals = events.goals;
        substitutions = events.substitutions;
        fetchSucceeded = true;
      } catch {
        // ESPN indisponible pour ce match précis : rien à mettre à jour ce tick-ci, le prochain
        // passage (dans la minute) réessaiera — pas la peine de faire échouer tout le cron pour ça.
      }

      const homePlayers = (await supabase.from("players").select("id, name").eq("team_id", match.home_team_id).is("left_at", null)).data ?? [];
      const awayPlayers = (await supabase.from("players").select("id, name").eq("team_id", match.away_team_id).is("left_at", null)).data ?? [];

      // Set mutable (pas juste existingSubKeys, figé avant la boucle) : ESPN renvoie parfois la
      // même entrée plusieurs fois dans une seule réponse (observé aussi côté buts, voir plus bas)
      // — sans mettre à jour ce set au fil de la boucle, chaque doublon du batch passait le test
      // indépendamment des autres et finissait inséré plusieurs fois en base.
      const seenSubKeysThisTick = new Set(existingSubKeys);
      const newSubRows = substitutions.flatMap((s) => {
        const teamId = teamNamesMatch(s.teamName, home.name) ? match.home_team_id : match.away_team_id;
        const candidates = teamId === match.home_team_id ? homePlayers : awayPlayers;
        const playerOut = matchPlayerByName(s.playerOutName, candidates);
        const playerIn = matchPlayerByName(s.playerInName, candidates);
        if (!playerOut && !playerIn) return [];
        const key = `${playerOut?.id ?? null}:${playerIn?.id ?? null}`;
        if (seenSubKeysThisTick.has(key)) return [];
        seenSubKeysThisTick.add(key);
        return [{ match_id: match.id, team_id: teamId, player_out_id: playerOut?.id ?? null, player_in_id: playerIn?.id ?? null, minute: s.minute }];
      });
      if (newSubRows.length > 0) {
        await supabase.from("match_substitutions").insert(newSubRows);
      }

      // Idem que seenSubKeysThisTick ci-dessus : ESPN a été observé à renvoyer le même but plusieurs
      // fois dans une seule réponse (cause du bug "but affiché 3 fois" — existingKeys seul, figé
      // avant la boucle, ne protégeait que contre un but déjà en base, jamais contre un doublon à
      // l'intérieur du même batch fraîchement reçu).
      const seenGoalKeysThisTick = new Set(existingKeys);
      const newGoalRows = goals.flatMap((g) => {
        const teamId = teamNamesMatch(g.teamName, home.name) ? match.home_team_id : match.away_team_id;
        const candidates = teamId === match.home_team_id ? homePlayers : awayPlayers;
        const scorer = matchPlayerByName(g.scorerName, candidates);
        const key = goalKey(scorer?.id ?? null, g.scorerName, g.minute);
        if (seenGoalKeysThisTick.has(key)) return [];
        seenGoalKeysThisTick.add(key);
        // Un but contre son camp (le buteur appartient à l'équipe qui ENCAISSE, pas celle créditée
        // du but — `candidates` cherche dans le mauvais effectif) ou un transfert tout juste arrivé
        // qu'football-data.org n'a pas encore synchronisé finissaient tous les deux par échouer
        // cette recherche : on garde le but quand même (player_id null, nom brut conservé) plutôt
        // que de le perdre silencieusement — voir migration 0039.
        const assist = g.assistName ? matchPlayerByName(g.assistName, candidates) : null;
        return [
          {
            match_id: match.id,
            team_id: teamId,
            player_id: scorer?.id ?? null,
            assist_player_id: assist?.id ?? null,
            minute: g.minute,
            scorerName: g.scorerName,
            assistName: g.assistName,
          },
        ];
      });

      if (newGoalRows.length > 0) {
        await supabase.from("match_goals").insert(
          newGoalRows.map((row) => ({
            match_id: row.match_id,
            team_id: row.team_id,
            player_id: row.player_id,
            assist_player_id: row.assist_player_id,
            minute: row.minute,
            scorer_name: row.scorerName,
            assist_name: row.assistName,
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

      // Passeur attaché tardivement par ESPN (souvent quelques minutes après le but lui-même) :
      // goalKey ne porte que sur buteur/minute, donc un but déjà en base ne serait jamais mis à
      // jour sans ce bloc dédié — uniquement pour compléter un passeur encore manquant, jamais pour
      // écraser une valeur déjà enregistrée.
      const assistBackfills = goals.flatMap((g) => {
        if (!g.assistName) return [];
        const teamId = teamNamesMatch(g.teamName, home.name) ? match.home_team_id : match.away_team_id;
        const candidates = teamId === match.home_team_id ? homePlayers : awayPlayers;
        const scorer = matchPlayerByName(g.scorerName, candidates);
        const key = goalKey(scorer?.id ?? null, g.scorerName, g.minute);
        const existing = existingGoalByKey.get(key);
        if (!existing || existing.assist_player_id != null || existing.assist_name != null) return [];
        const assist = matchPlayerByName(g.assistName, candidates);
        return [{ id: existing.id, assist_player_id: assist?.id ?? null, assist_name: g.assistName }];
      });
      if (assistBackfills.length > 0) {
        await Promise.all(
          assistBackfills.map((row) =>
            supabase.from("match_goals").update({ assist_player_id: row.assist_player_id, assist_name: row.assist_name }).eq("id", row.id)
          )
        );
      }

      // But annulé (VAR, hors-jeu revu après coup...) : arrive assez souvent pour qu'on ne puisse
      // pas se contenter d'ajouter, il faut aussi retirer ce qu'ESPN ne reconnaît plus comme un
      // but valide. On ne compare qu'aux buts déjà en base AVANT ce tick (existingGoals, pas
      // newGoalRows tout juste insérés) contre la liste actuelle d'ESPN : un but qui a disparu
      // entre deux passages n'a plus lieu d'être affiché.
      if (fetchSucceeded) {
        const currentEspnGoalKeys = new Set(
          goals.map((g) => {
            const teamId = teamNamesMatch(g.teamName, home.name) ? match.home_team_id : match.away_team_id;
            const candidates = teamId === match.home_team_id ? homePlayers : awayPlayers;
            const scorer = matchPlayerByName(g.scorerName, candidates);
            return goalKey(scorer?.id ?? null, g.scorerName, g.minute);
          })
        );
        const cancelledGoalIds = (existingGoals ?? [])
          .filter((g) => !currentEspnGoalKeys.has(goalKey(g.player_id, g.scorer_name, g.minute)))
          .map((g) => g.id);
        if (cancelledGoalIds.length > 0) {
          await supabase.from("match_goals").delete().in("id", cancelledGoalIds);
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

  if (pendingCount > 0) {
    try {
      await scheduleNextTick(liveCount > 0 ? LIVE_TICK_DELAY_SECONDS : WARMUP_TICK_DELAY_SECONDS);
    } catch {
      // Pas grave : le prochain réveil de sync-fixtures (au plus 30 min) reprendra la main.
    }
  }

  return NextResponse.json({
    inWindow: inWindowMatches.length,
    pending: pendingCount,
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
  // null : joueur absent de l'effectif synchronisé (transfert récent, ou but contre son camp —
  // voir migration 0039). Ne peut alors correspondre à aucun pronostic buteur/passeur, ce joueur
  // n'ayant jamais pu être proposé dans la liste au moment du pronostic.
  player_id: number | null;
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
  // Plus de diffusion à tout le monde par défaut : uniquement ceux qui ont activé la cloche de
  // CE match (voir MatchPredictionCard) — sortir tout de suite s'il n'y a personne à notifier,
  // sans même aller chercher les pronostics.
  const [{ data: predictions }, { data: subscriptions }] = await Promise.all([
    supabase
      .from("match_predictions")
      .select("user_id, predicted_scorer_player_id, predicted_assist_player_id")
      .eq("match_id", match.id),
    supabase.from("match_goal_subscriptions").select("user_id").eq("match_id", match.id),
  ]);
  const subscribedUserIds = (subscriptions ?? []).map((s) => s.user_id);
  if (subscribedUserIds.length === 0) return;

  const minuteLabel = goal.minute != null ? ` (${goal.minute}')` : "";
  const fallback = {
    title: SYSTEM_SENDER_NAME,
    body: `⚽ But ! ${homeName} ${homeScore} - ${awayScore} ${awayName} — ${goal.scorerName}${minuteLabel}`,
    url: `${APP_URL}/calendar`,
  };

  // Garantie buteur/passeur : un pronostic sur le joueur remplacé compte aussi si c'est son
  // remplaçant qui marque/passe à sa place (voir process-scoring pour le calcul définitif après
  // coup — cette notif temps réel applique la même règle).
  const scorerReplacedFor = goal.player_id != null ? playerInToOut.get(goal.player_id) : undefined;
  const assistReplacedFor = goal.assist_player_id != null ? playerInToOut.get(goal.assist_player_id) : undefined;

  const overrides = new Map<string, { title: string; body: string; url?: string }>();
  for (const pred of predictions ?? []) {
    // goal.player_id == null (joueur non résolu) ne peut correspondre à AUCUN pronostic — sans ce
    // garde-fou, "personne n'a pronostiqué de buteur" (predicted_scorer_player_id aussi null) se
    // lirait à tort comme un pronostic gagnant.
    const scorerHit =
      goal.player_id != null &&
      (pred.predicted_scorer_player_id === goal.player_id || pred.predicted_scorer_player_id === scorerReplacedFor);
    const assistHit =
      goal.assist_player_id != null &&
      (pred.predicted_assist_player_id === goal.assist_player_id || pred.predicted_assist_player_id === assistReplacedFor);
    if (scorerHit || assistHit) {
      const bonus = scorerHit && assistHit ? "Buteur ET passeur trouvés, énorme 🔥" : scorerHit ? "Ton pronostic buteur est bon 🎯" : "Ton pronostic passeur est bon 🎯";
      overrides.set(pred.user_id, { ...fallback, body: `${fallback.body}\n${bonus}` });
    }
  }

  await sendPushToUserIdsWithOverrides(subscribedUserIds, overrides, fallback);
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
