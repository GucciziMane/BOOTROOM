import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { matchPlayerByName, normalizeName, findFixture, teamSideOf } from "@/lib/sync/name-match";
import { getEspnScoreboard, getEspnMatchEvents, ESPN_LEAGUE_SLUG } from "@/lib/espn/client";
import { awardLateScorerAssistPoints } from "@/app/api/cron/process-scoring/route";
import { sendPushToUserIds, sendPushToUserIdsWithOverrides } from "@/lib/push/server";

export const maxDuration = 300;

// Audit automatique des buteurs/passeurs, tous les 3 jours (vercel.json) — la version automatisée
// de l'audit manuel du 17/10/2026, qui avait trouvé 45 buts/passes jamais reliés à un joueur
// (doublons d'effectif, homonymes, variantes d'orthographe), donc des points buteur/passeur jamais
// versés à des pronostics pourtant gagnants. Chaque passage :
// 0. pour tout match dont le nombre de buts enregistrés ≠ score final, récupère sur ESPN les buts
//    manquants (ajoutés par ESPN après la synchro du match, ou doublé dans le temps additionnel
//    écrasé par la contrainte unique — 3 cas trouvés le 17/10) et les insère ;
// 1. retente de relier chaque but/passe encore orphelin avec l'algorithme ACTUEL (qui a pu
//    progresser, ou l'effectif être complété, depuis la synchro du match) ;
// 2. verse les points rattrapés via awardLateScorerAssistPoints (idempotent : jamais deux fois) et
//    prévient chaque joueur concerné par une notif ;
// 3. signale à l'admin ce qui reste à voir à la main (buts ≠ score malgré ESPN, nouveaux doublons
//    d'effectif) — une seule fois par problème, jamais un "tout va bien".
const AUDIT_WINDOW_DAYS = 30;

type GoalRow = {
  id: number;
  match_id: number;
  team_id: number;
  scorer_name: string | null;
  player_id: number | null;
  assist_name: string | null;
  assist_player_id: number | null;
};

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const startedAt = new Date().toISOString();
  const since = new Date(Date.now() - AUDIT_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: matches } = await supabase
    .from("matches")
    .select("id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, points_processed_at, events_synced_at")
    .eq("status", "finished")
    .gte("kickoff_at", since);
  if (!matches || matches.length === 0) return NextResponse.json({ matches: 0 });
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const loadGoals = async () => {
    const { data } = await supabase
      .from("match_goals")
      .select("id, match_id, team_id, scorer_name, player_id, assist_name, assist_player_id")
      .in(
        "match_id",
        matches.map((m) => m.id)
      );
    return (data ?? []) as GoalRow[];
  };
  const countGoals = (rows: GoalRow[]) => {
    const counts = new Map<number, number>();
    for (const g of rows) counts.set(g.match_id, (counts.get(g.match_id) ?? 0) + 1);
    return counts;
  };
  const isMismatch = (m: (typeof matches)[number], counts: Map<number, number>) =>
    m.home_score != null &&
    m.away_score != null &&
    m.events_synced_at != null && // sinon déjà couvert par l'alerte "buteurs introuvables" de sync-fixtures
    (counts.get(m.id) ?? 0) !== m.home_score + m.away_score;

  // --- 0. Récupérer sur ESPN les buts manquants ----------------------------------------------
  let goals = await loadGoals();
  const toRepair = matches.filter((m) => isMismatch(m, countGoals(goals)));
  const repairedMatchIds = new Set<number>();
  let goalsInserted = 0;
  if (toRepair.length > 0) {
    const leagueIds = [...new Set(toRepair.map((m) => m.league_id))];
    const { data: leagues } = await supabase.from("leagues").select("id, football_data_code").in("id", leagueIds);
    const slugByLeague = new Map((leagues ?? []).map((l) => [l.id, ESPN_LEAGUE_SLUG[l.football_data_code]]));
    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", [...new Set(toRepair.flatMap((m) => [m.home_team_id, m.away_team_id]))]);
    const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
    const { data: kickoffs } = await supabase.from("matches").select("id, kickoff_at").in("id", toRepair.map((m) => m.id));
    const kickoffById = new Map((kickoffs ?? []).map((k) => [k.id, k.kickoff_at]));

    for (const m of toRepair) {
      const slug = slugByLeague.get(m.league_id);
      const kickoffAt = kickoffById.get(m.id);
      if (!slug || !kickoffAt) continue;
      try {
        const ymd = kickoffAt.slice(0, 10).replace(/-/g, "");
        // Coup d'envoi tardif en UTC (ex: 23h) : le match peut être listé au jour suivant chez ESPN.
        const nextYmd = new Date(new Date(kickoffAt).getTime() + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
        const dayEvents = [...(await getEspnScoreboard(slug, ymd, ymd)), ...(await getEspnScoreboard(slug, nextYmd, nextYmd))];
        const found = findFixture(
          dayEvents,
          {
            homeName: teamName.get(m.home_team_id) ?? "",
            awayName: teamName.get(m.away_team_id) ?? "",
            kickoffAt,
            homeScore: m.home_score,
            awayScore: m.away_score,
          },
          (e) => ({ home: e.homeTeam, away: e.awayTeam, date: e.date, homeScore: e.homeScore, awayScore: e.awayScore })
        );
        if (!found) continue;
        const { goals: espnGoals } = await getEspnMatchEvents(slug, found.fixture.id);
        // ESPN doit lui-même tomber juste, sinon on ne sait pas lesquels insérer.
        if (espnGoals.length !== (m.home_score ?? 0) + (m.away_score ?? 0)) continue;

        // Par buteur (nom normalisé) : on n'insère que les buts ESPN au-delà de ceux déjà en base
        // pour ce même buteur — robuste à une minute qui diffère entre les deux (ex: "90" en base,
        // "92" désormais que le temps additionnel est compté).
        const existingByScorer = new Map<string, number>();
        for (const g of goals.filter((g) => g.match_id === m.id)) {
          const key = normalizeName(g.scorer_name ?? "");
          existingByScorer.set(key, (existingByScorer.get(key) ?? 0) + 1);
        }
        const source = { home: found.fixture.homeTeam, away: found.fixture.awayTeam };
        const rows = espnGoals.flatMap((g) => {
          const key = normalizeName(g.scorerName);
          const remaining = existingByScorer.get(key) ?? 0;
          if (remaining > 0) {
            existingByScorer.set(key, remaining - 1);
            return [];
          }
          const side = teamSideOf(g.teamName, source, found.flipped);
          // player_id/assist_player_id laissés vides : l'étape 1 juste après les relie avec les
          // mêmes règles (et le même garde-fou but contre son camp) que tout autre orphelin.
          return [
            {
              match_id: m.id,
              team_id: side === "home" ? m.home_team_id : m.away_team_id,
              player_id: null,
              assist_player_id: null,
              minute: g.minute,
              scorer_name: g.scorerName,
              assist_name: g.assistName,
            },
          ];
        });
        if (rows.length > 0) {
          const { error } = await supabase.from("match_goals").insert(rows);
          if (!error) {
            goalsInserted += rows.length;
            repairedMatchIds.add(m.id);
          }
        }
      } catch {
        // ESPN indisponible : on retentera au prochain passage.
      }
    }
    if (goalsInserted > 0) goals = await loadGoals();
  }

  // --- 1. Relier les buts/passes orphelins ---------------------------------------------------
  const orphans = goals.filter((g) => (g.player_id == null && g.scorer_name) || (g.assist_player_id == null && g.assist_name));
  const teamIds = [...new Set(orphans.flatMap((g) => {
    const m = matchById.get(g.match_id)!;
    return [m.home_team_id, m.away_team_id];
  }))];
  const { data: players } = teamIds.length
    ? await supabase.from("players").select("id, name, team_id, position").in("team_id", teamIds).is("left_at", null)
    : { data: [] };
  const playersByTeam = new Map<number, Array<{ id: number; name: string; position: string | null }>>();
  for (const p of players ?? []) playersByTeam.set(p.team_id, [...(playersByTeam.get(p.team_id) ?? []), p]);

  const linked: Array<{ goalId: number; matchId: number; kind: "buteur" | "passeur"; source: string; player: string }> = [];
  // Un but tout juste récupéré sur ESPN peut ne relier personne (but contre son camp) mais change
  // quand même le résultat d'un pronostic via la garantie remplaçant : on retente le paiement.
  const matchesWithNewLinks = new Set<number>(repairedMatchIds);
  for (const g of orphans) {
    const m = matchById.get(g.match_id)!;
    const own = playersByTeam.get(g.team_id) ?? [];
    const opponents = playersByTeam.get(g.team_id === m.home_team_id ? m.away_team_id : m.home_team_id) ?? [];
    const update: { player_id?: number; assist_player_id?: number } = {};

    if (g.player_id == null && g.scorer_name) {
      // But contre son camp : le buteur appartient à l'équipe qui ENCAISSE. Ne jamais le créditer
      // à un coéquipier homonyme de l'équipe qui en bénéficie (vu le 17/10 : "Isaac Romero"
      // adverse aurait été relié à "Rafa Romero").
      const isOwnGoal = matchPlayerByName(g.scorer_name, opponents) != null;
      const scorer = isOwnGoal ? null : matchPlayerByName(g.scorer_name, own);
      if (scorer) {
        update.player_id = scorer.id;
        linked.push({ goalId: g.id, matchId: g.match_id, kind: "buteur", source: g.scorer_name, player: scorer.name });
      }
    }
    if (g.assist_player_id == null && g.assist_name) {
      const assist = matchPlayerByName(g.assist_name, own);
      if (assist) {
        update.assist_player_id = assist.id;
        linked.push({ goalId: g.id, matchId: g.match_id, kind: "passeur", source: g.assist_name, player: assist.name });
      }
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("match_goals").update(update).eq("id", g.id);
      if (!error) matchesWithNewLinks.add(g.match_id);
    }
  }

  // --- 2. Rattraper les points et prévenir les joueurs ---------------------------------------
  for (const matchId of matchesWithNewLinks) {
    const m = matchById.get(matchId)!;
    // Pas encore noté : process-scoring paiera normalement avec les buts désormais reliés.
    if (!m.points_processed_at) continue;
    const [{ data: currentGoals }, { data: currentSubs }] = await Promise.all([
      supabase.from("match_goals").select("player_id, assist_player_id").eq("match_id", matchId),
      supabase.from("match_substitutions").select("player_out_id, player_in_id").eq("match_id", matchId),
    ]);
    await awardLateScorerAssistPoints(supabase, matchId, m.league_id, m.season_id, currentGoals ?? [], currentSubs ?? []);
  }

  const { data: newLedgerRows } = matchesWithNewLinks.size
    ? await supabase
        .from("points_ledger")
        .select("user_id, source_type, source_id, points")
        .in("source_type", ["match_scorer", "match_assist"])
        .in("source_id", [...matchesWithNewLinks])
        .gte("created_at", startedAt)
    : { data: [] };
  const payouts = newLedgerRows ?? [];

  if (payouts.length > 0) {
    const pointsByUser = new Map<string, number>();
    for (const row of payouts) pointsByUser.set(row.user_id, (pointsByUser.get(row.user_id) ?? 0) + row.points);
    const overrides = new Map(
      [...pointsByUser].map(([userId, points]) => [
        userId,
        {
          title: `⚽ +${points} pts rattrapés !`,
          body: "Un de tes pronostics buteur/passeur était gagnant mais n'avait pas encore été compté : c'est corrigé, les points sont crédités.",
          url: "/leaderboard",
        },
      ])
    );
    await sendPushToUserIdsWithOverrides([...pointsByUser.keys()], overrides, {
      title: "⚽ Points rattrapés",
      body: "Des points buteur/passeur oubliés viennent d'être crédités.",
      url: "/leaderboard",
    });
  }

  // --- 3. Ce qui demande un œil humain --------------------------------------------------------
  // Nombre de buts ≠ score même après ESPN : un but manque (ou est en trop) que l'audit ne peut
  // pas inventer. Prévenu une seule fois par match (liste mémorisée dans app_settings).
  const goalCountByMatch = countGoals(goals);
  const scoreMismatches = matches.filter((m) => isMismatch(m, goalCountByMatch));
  const { data: alertedRow } = await supabase.from("app_settings").select("value").eq("key", "scorer_audit_alerted_mismatches").maybeSingle();
  const alreadyAlerted = new Set((alertedRow?.value ?? "").split(",").filter(Boolean).map(Number));
  const newMismatches = scoreMismatches.filter((m) => !alreadyAlerted.has(m.id));

  // Doublons d'effectif (même équipe, même nom normalisé) : cause des 47 buteurs perdus du 17/10.
  const { data: activePlayers } = await supabase.from("players").select("id, team_id, name").is("left_at", null);
  const seen = new Map<string, number>();
  let duplicatePlayers = 0;
  for (const p of activePlayers ?? []) {
    const key = `${p.team_id}|${normalizeName(p.name)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const count of seen.values()) if (count > 1) duplicatePlayers++;

  const remainingOrphans = orphans.length - linked.length;
  const summary = {
    matches: matches.length,
    goalsInsertedFromEspn: goalsInserted,
    orphansFound: orphans.length,
    linked: linked.length,
    remainingOrphans,
    payouts: payouts.length,
    pointsAwarded: payouts.reduce((sum, r) => sum + r.points, 0),
    scoreMismatches: scoreMismatches.map((m) => m.id),
    duplicatePlayerGroups: duplicatePlayers,
  };

  // Une seule notif admin par passage, et seulement s'il s'est passé quelque chose à savoir —
  // jamais un "tout va bien" tous les 3 jours. Les homonymes réels connus (deux "Pedrinho"...)
  // comptent dans duplicatePlayerGroups : on ne prévient que s'il y en a plus qu'au dernier passage.
  const { data: lastRow } = await supabase.from("app_settings").select("value").eq("key", "scorer_audit_last_duplicate_groups").maybeSingle();
  const lastDuplicates = Number(lastRow?.value ?? 0);
  const lines: string[] = [];
  if (payouts.length > 0) lines.push(`${summary.pointsAwarded} pts rattrapés (${payouts.length} pronostic(s)), joueurs prévenus.`);
  if (goalsInserted > 0) lines.push(`${goalsInserted} but(s) manquant(s) récupéré(s) sur ESPN.`);
  if (newMismatches.length > 0) lines.push(`${newMismatches.length} match(s) dont le nombre de buts ≠ score, à vérifier.`);
  if (duplicatePlayers > lastDuplicates) lines.push(`${duplicatePlayers - lastDuplicates} nouveau(x) doublon(s) d'effectif.`);
  if (lines.length > 0) {
    const { data: admins } = await supabase.from("profiles").select("id").eq("is_admin", true);
    await sendPushToUserIds((admins ?? []).map((a) => a.id), {
      title: "🔎 Boot Room — Audit buteurs/passeurs",
      body: lines.join(" "),
      url: "/admin",
    });
  }
  await supabase.from("app_settings").upsert([
    { key: "scorer_audit_last_duplicate_groups", value: String(duplicatePlayers) },
    { key: "scorer_audit_alerted_mismatches", value: scoreMismatches.map((m) => m.id).join(",") },
  ]);

  return NextResponse.json({ ...summary, linkedDetails: linked });
}
