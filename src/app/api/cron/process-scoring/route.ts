import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  computeMatchScorePoints,
  computeSeasonPositionPoints,
  resolveScorerTierPoints,
  resolveAssistTierPoints,
  predictedWinnerTeamId,
  applyResultOdds,
  FALLBACK_SCORER_TIER,
  type PointConfig,
  type OddsTier,
  type ResultTierMultiplier,
} from "@/lib/scoring/points";
import { computeStandings } from "@/lib/scoring/standings";
import type { PointsSourceType } from "@/types/database";

const MAX_MATCHES_PER_RUN = 100;
// Délai laissé à la sync des buteurs (API-Football) avant de traiter un match quand même :
// si la clé API-Football est invalide/en panne, on ne veut pas bloquer indéfiniment les points
// de score (qui n'en dépendent pas) en attendant des buteurs qui ne viendront jamais.
const EVENTS_SYNC_GRACE_MS = 6 * 60 * 60 * 1000;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function loadPointConfig(supabase: ServiceClient): Promise<PointConfig> {
  const { data } = await supabase.from("point_config").select("key, points");
  const map = new Map((data ?? []).map((r) => [r.key, r.points]));
  return {
    matchExactScore: map.get("match_exact_score") ?? 30,
    matchCorrectResultNoScore: map.get("match_correct_result_no_score") ?? 10,
    seasonPositionExact: map.get("season_position_exact") ?? 50,
    seasonPositionPresence: map.get("season_position_presence") ?? 15,
    seasonSurpriseTeam: map.get("season_surprise_team") ?? 40,
    seasonFlopTeam: map.get("season_flop_team") ?? 40,
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const config = await loadPointConfig(supabase);

  const matchesResult = await processFinishedMatches(supabase, config);
  const seasonsResult = await processFinishedSeasons(supabase, config);

  return NextResponse.json({ matches: matchesResult, seasons: seasonsResult });
}

async function processFinishedMatches(supabase: ServiceClient, config: PointConfig) {
  const eventsSyncDeadline = new Date(Date.now() - EVENTS_SYNC_GRACE_MS).toISOString();

  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, favorite_team_id, odds_tier")
    .eq("status", "finished")
    .is("points_processed_at", null)
    .or(`events_synced_at.not.is.null,kickoff_at.lt.${eventsSyncDeadline}`)
    .limit(MAX_MATCHES_PER_RUN);

  if (error || !matches || matches.length === 0) {
    return { processed: 0, error: error?.message };
  }

  const { data: tierPoints } = await supabase.from("match_scorer_tier_points").select("tier, points");
  const tierPointsMap = new Map((tierPoints ?? []).map((t) => [t.tier, t.points]));

  const { data: assistTierPoints } = await supabase.from("match_assist_tier_points").select("tier, points");
  const assistTierPointsMap = new Map((assistTierPoints ?? []).map((t) => [t.tier, t.points]));

  const { data: resultMultipliers } = await supabase
    .from("match_result_tier_multipliers")
    .select("tier, favorite_multiplier_pct, underdog_multiplier_pct");
  const resultMultiplierMap = new Map<OddsTier, ResultTierMultiplier>(
    (resultMultipliers ?? []).map((r) => [
      r.tier,
      { favoriteMultiplierPct: r.favorite_multiplier_pct, underdogMultiplierPct: r.underdog_multiplier_pct },
    ])
  );

  const finishedMatches = matches.filter((m) => m.home_score !== null && m.away_score !== null);
  if (finishedMatches.length === 0) return { processed: 0 };

  const matchIds = finishedMatches.map((m) => m.id);
  const seasonIds = [...new Set(finishedMatches.map((m) => m.season_id))];

  // Tout précalculé en 5 requêtes groupées plutôt que jusqu'à 5 requêtes PAR match (+ jusqu'à 2
  // de plus par pronostic) : à MAX_MATCHES_PER_RUN=100 matchs et quelques amis chacun, l'ancienne
  // version pouvait dépasser le millier d'allers-retours DB séquentiels dans un seul run de cron.
  const [{ data: allPredictions }, { data: allGoals }, { data: existingLedger }, { data: scorerTierRows }, { data: assistTierRows }] =
    await Promise.all([
      supabase
        .from("match_predictions")
        .select(
          "id, match_id, user_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id, predicted_assist_player_id"
        )
        .in("match_id", matchIds),
      supabase.from("match_goals").select("match_id, player_id, assist_player_id").in("match_id", matchIds),
      supabase
        .from("points_ledger")
        .select("user_id, source_type, source_id")
        .in("source_id", matchIds)
        .in("source_type", ["match_score", "match_scorer", "match_assist"]),
      supabase.from("player_scoring_tier").select("player_id, tier").in("season_id", seasonIds),
      supabase.from("player_assist_tier").select("player_id, tier").in("season_id", seasonIds),
    ]);

  const predictionsByMatch = new Map<number, NonNullable<typeof allPredictions>>();
  for (const p of allPredictions ?? []) {
    if (!predictionsByMatch.has(p.match_id)) predictionsByMatch.set(p.match_id, []);
    predictionsByMatch.get(p.match_id)!.push(p);
  }
  const scorersByMatch = new Map<number, Set<number>>();
  const assistersByMatch = new Map<number, Set<number>>();
  for (const g of allGoals ?? []) {
    if (g.player_id != null) {
      if (!scorersByMatch.has(g.match_id)) scorersByMatch.set(g.match_id, new Set());
      scorersByMatch.get(g.match_id)!.add(g.player_id);
    }
    if (g.assist_player_id != null) {
      if (!assistersByMatch.has(g.match_id)) assistersByMatch.set(g.match_id, new Set());
      assistersByMatch.get(g.match_id)!.add(g.assist_player_id);
    }
  }
  const alreadyAwarded = new Set((existingLedger ?? []).map((r) => `${r.source_id}:${r.user_id}:${r.source_type}`));
  // Un même joueur n'a qu'un seul tier par saison en pratique (une seule ligue à la fois) : la clé
  // ne porte que sur player_id, pas besoin du season_id ici contrairement à une lecture par match.
  const scorerTierByPlayer = new Map((scorerTierRows ?? []).map((r) => [r.player_id, r.tier]));
  const assistTierByPlayer = new Map((assistTierRows ?? []).map((r) => [r.player_id, r.tier]));

  const ledgerInserts: Array<{ user_id: string; league_id: number; source_type: PointsSourceType; source_id: number; points: number }> = [];
  const predictionUpdates: Array<{
    id: number;
    user_id: string;
    match_id: number;
    predicted_home_score: number;
    predicted_away_score: number;
    points_awarded: number;
  }> = [];

  for (const match of finishedMatches) {
    const homeScore = match.home_score as number;
    const awayScore = match.away_score as number;
    const actualScorers = scorersByMatch.get(match.id) ?? new Set();
    const actualAssisters = assistersByMatch.get(match.id) ?? new Set();

    for (const pred of predictionsByMatch.get(match.id) ?? []) {
      const baseScorePoints = computeMatchScorePoints(
        pred.predicted_home_score,
        pred.predicted_away_score,
        homeScore,
        awayScore,
        config
      );
      const winnerTeamId = predictedWinnerTeamId(
        pred.predicted_home_score,
        pred.predicted_away_score,
        match.home_team_id,
        match.away_team_id
      );
      const scorePoints = applyResultOdds(
        baseScorePoints,
        winnerTeamId,
        match.favorite_team_id,
        match.odds_tier,
        resultMultiplierMap
      );

      const scorerPoints =
        pred.predicted_scorer_player_id && actualScorers.has(pred.predicted_scorer_player_id)
          ? resolveScorerTierPoints(scorerTierByPlayer.get(pred.predicted_scorer_player_id), tierPointsMap)
          : 0;
      const assistPoints =
        pred.predicted_assist_player_id && actualAssisters.has(pred.predicted_assist_player_id)
          ? resolveAssistTierPoints(assistTierByPlayer.get(pred.predicted_assist_player_id), assistTierPointsMap)
          : 0;

      const toAward: Array<[PointsSourceType, number]> = [
        ["match_score", scorePoints],
        ["match_scorer", scorerPoints],
        ["match_assist", assistPoints],
      ];
      for (const [sourceType, points] of toAward) {
        if (points > 0 && !alreadyAwarded.has(`${match.id}:${pred.user_id}:${sourceType}`)) {
          ledgerInserts.push({ user_id: pred.user_id, league_id: match.league_id, source_type: sourceType, source_id: match.id, points });
        }
      }

      predictionUpdates.push({
        id: pred.id,
        user_id: pred.user_id,
        match_id: match.id,
        predicted_home_score: pred.predicted_home_score,
        predicted_away_score: pred.predicted_away_score,
        points_awarded: scorePoints + scorerPoints + assistPoints,
      });
    }
  }

  if (ledgerInserts.length > 0) await supabase.from("points_ledger").insert(ledgerInserts);
  if (predictionUpdates.length > 0) await supabase.from("match_predictions").upsert(predictionUpdates, { onConflict: "id" });
  await supabase
    .from("matches")
    .update({ points_processed_at: new Date().toISOString() })
    .in("id", matchIds);

  return { processed: finishedMatches.length };
}

async function processFinishedSeasons(supabase: ServiceClient, config: PointConfig) {
  const { data: seasons, error } = await supabase
    .from("seasons")
    .select("id, league_id, actual_surprise_team_id, actual_flop_team_id")
    .eq("status", "finished");

  if (error || !seasons || seasons.length === 0) {
    return { processed: 0, error: error?.message };
  }

  const { data: tierPoints } = await supabase.from("season_top_player_tier_points").select("tier, points");
  const tierPointsMap = new Map((tierPoints ?? []).map((t) => [t.tier, t.points]));

  const results = [];
  for (const season of seasons) {
    const { data: teams } = await supabase.from("teams").select("id").eq("league_id", season.league_id);
    const teamIds = (teams ?? []).map((t) => t.id);

    const { data: matches } = await supabase
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score")
      .eq("season_id", season.id)
      .eq("status", "finished");

    const matchResults = (matches ?? [])
      .filter((m) => m.home_score !== null && m.away_score !== null)
      .map((m) => ({
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        homeScore: m.home_score as number,
        awayScore: m.away_score as number,
      }));

    const standings = computeStandings(matchResults, teamIds);
    const top3TeamIds = standings.slice(0, 3).map((s) => s.teamId);
    const bottom3TeamIds = standings
      .slice(-3)
      .reverse()
      .map((s) => s.teamId); // rang 1 = dernier

    const { data: seasonMatches } = await supabase.from("matches").select("id").eq("season_id", season.id);
    const seasonMatchIds = (seasonMatches ?? []).map((m) => m.id);

    const goalsByPlayer = new Map<number, number>();
    const assistsByPlayer = new Map<number, number>();
    if (seasonMatchIds.length > 0) {
      const { data: goals } = await supabase
        .from("match_goals")
        .select("player_id, assist_player_id")
        .in("match_id", seasonMatchIds);
      for (const g of goals ?? []) {
        if (g.player_id) goalsByPlayer.set(g.player_id, (goalsByPlayer.get(g.player_id) ?? 0) + 1);
        if (g.assist_player_id) assistsByPlayer.set(g.assist_player_id, (assistsByPlayer.get(g.assist_player_id) ?? 0) + 1);
      }
    }
    const actualTopScorerIds = topEntries(goalsByPlayer);
    const actualTopAssistIds = topEntries(assistsByPlayer);

    const { data: existingLedger } = await supabase
      .from("points_ledger")
      .select("user_id, source_type")
      .eq("source_id", season.id)
      .in("source_type", [
        "season_top_scorer",
        "season_top_assist",
        "season_top3",
        "season_bottom3",
        "season_surprise",
        "season_flop",
      ]);
    const alreadyAwarded = new Set((existingLedger ?? []).map((r) => `${r.user_id}:${r.source_type}`));

    const { data: predictions } = await supabase
      .from("season_predictions")
      .select("user_id, top_scorer_player_id, top_assist_player_id, top3, bottom3, surprise_team_id, flop_team_id")
      .eq("season_id", season.id);

    for (const pred of predictions ?? []) {
      const award = async (sourceType: PointsSourceType, points: number) => {
        if (points <= 0) return;
        if (alreadyAwarded.has(`${pred.user_id}:${sourceType}`)) return;
        await supabase.from("points_ledger").insert({
          user_id: pred.user_id,
          league_id: season.league_id,
          source_type: sourceType,
          source_id: season.id,
          points,
        });
      };

      if (pred.top_scorer_player_id && actualTopScorerIds.has(pred.top_scorer_player_id)) {
        const tier = await getPlayerTier(supabase, pred.top_scorer_player_id, season.id);
        await award("season_top_scorer", tierPointsMap.get(tier) ?? 150);
      }
      if (pred.top_assist_player_id && actualTopAssistIds.has(pred.top_assist_player_id)) {
        const tier = await getPlayerTier(supabase, pred.top_assist_player_id, season.id);
        await award("season_top_assist", tierPointsMap.get(tier) ?? 150);
      }

      const top3 = (pred.top3 as Record<string, number>) ?? {};
      const top3Points = [1, 2, 3].reduce(
        (sum, rank) => sum + computeSeasonPositionPoints(top3[String(rank)], rank, top3TeamIds, config),
        0
      );
      await award("season_top3", top3Points);

      const bottom3 = (pred.bottom3 as Record<string, number>) ?? {};
      const bottom3Points = [1, 2, 3].reduce(
        (sum, rank) => sum + computeSeasonPositionPoints(bottom3[String(rank)], rank, bottom3TeamIds, config),
        0
      );
      await award("season_bottom3", bottom3Points);

      if (season.actual_surprise_team_id && pred.surprise_team_id === season.actual_surprise_team_id) {
        await award("season_surprise", config.seasonSurpriseTeam);
      }
      if (season.actual_flop_team_id && pred.flop_team_id === season.actual_flop_team_id) {
        await award("season_flop", config.seasonFlopTeam);
      }
    }

    const fullyResolved = Boolean(season.actual_surprise_team_id && season.actual_flop_team_id);
    if (fullyResolved) {
      await supabase.from("seasons").update({ points_processed_at: new Date().toISOString() }).eq("id", season.id);
    }

    results.push({ seasonId: season.id, predictions: predictions?.length ?? 0, fullyResolved });
  }

  return { processed: results.length, results };
}

/** Tous les joueurs à égalité au sommet (jamais un seul choisi arbitrairement en cas d'égalité) :
 * quiconque a pronostiqué l'un d'eux touche les points, chacun sur la base de son propre tier. */
function topEntries(counts: Map<number, number>): Set<number> {
  let bestCount = 0;
  for (const count of counts.values()) {
    if (count > bestCount) bestCount = count;
  }
  if (bestCount === 0) return new Set();
  return new Set([...counts.entries()].filter(([, count]) => count === bestCount).map(([id]) => id));
}

async function getPlayerTier(
  supabase: ServiceClient,
  playerId: number,
  seasonId: number
): Promise<1 | 2 | 3 | 4 | 5> {
  const { data } = await supabase
    .from("player_scoring_tier")
    .select("tier")
    .eq("player_id", playerId)
    .eq("season_id", seasonId)
    .maybeSingle();
  return data?.tier ?? FALLBACK_SCORER_TIER;
}
