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

  let processed = 0;
  for (const match of matches) {
    if (match.home_score === null || match.away_score === null) continue;

    const { data: predictions } = await supabase
      .from("match_predictions")
      .select(
        "id, user_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id, predicted_assist_player_id"
      )
      .eq("match_id", match.id);

    const { data: goals } = await supabase
      .from("match_goals")
      .select("player_id, assist_player_id")
      .eq("match_id", match.id);
    const actualScorers = new Set((goals ?? []).map((g) => g.player_id).filter((id): id is number => id !== null));
    const actualAssisters = new Set(
      (goals ?? []).map((g) => g.assist_player_id).filter((id): id is number => id !== null)
    );

    const { data: existingLedger } = await supabase
      .from("points_ledger")
      .select("user_id, source_type")
      .eq("source_id", match.id)
      .in("source_type", ["match_score", "match_scorer", "match_assist"]);
    const alreadyAwarded = new Set((existingLedger ?? []).map((r) => `${r.user_id}:${r.source_type}`));

    for (const pred of predictions ?? []) {
      const baseScorePoints = computeMatchScorePoints(
        pred.predicted_home_score,
        pred.predicted_away_score,
        match.home_score,
        match.away_score,
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

      let scorerPoints = 0;
      if (pred.predicted_scorer_player_id && actualScorers.has(pred.predicted_scorer_player_id)) {
        const { data: tierRow } = await supabase
          .from("player_scoring_tier")
          .select("tier")
          .eq("player_id", pred.predicted_scorer_player_id)
          .eq("season_id", match.season_id)
          .maybeSingle();
        scorerPoints = resolveScorerTierPoints(tierRow?.tier, tierPointsMap);
      }

      let assistPoints = 0;
      if (pred.predicted_assist_player_id && actualAssisters.has(pred.predicted_assist_player_id)) {
        const { data: assistTierRow } = await supabase
          .from("player_assist_tier")
          .select("tier")
          .eq("player_id", pred.predicted_assist_player_id)
          .eq("season_id", match.season_id)
          .maybeSingle();
        assistPoints = resolveAssistTierPoints(assistTierRow?.tier, assistTierPointsMap);
      }

      if (scorePoints > 0 && !alreadyAwarded.has(`${pred.user_id}:match_score`)) {
        await supabase.from("points_ledger").insert({
          user_id: pred.user_id,
          league_id: match.league_id,
          source_type: "match_score",
          source_id: match.id,
          points: scorePoints,
        });
      }
      if (scorerPoints > 0 && !alreadyAwarded.has(`${pred.user_id}:match_scorer`)) {
        await supabase.from("points_ledger").insert({
          user_id: pred.user_id,
          league_id: match.league_id,
          source_type: "match_scorer",
          source_id: match.id,
          points: scorerPoints,
        });
      }
      if (assistPoints > 0 && !alreadyAwarded.has(`${pred.user_id}:match_assist`)) {
        await supabase.from("points_ledger").insert({
          user_id: pred.user_id,
          league_id: match.league_id,
          source_type: "match_assist",
          source_id: match.id,
          points: assistPoints,
        });
      }

      await supabase
        .from("match_predictions")
        .update({ points_awarded: scorePoints + scorerPoints + assistPoints })
        .eq("id", pred.id);
    }

    await supabase.from("matches").update({ points_processed_at: new Date().toISOString() }).eq("id", match.id);
    processed++;
  }

  return { processed };
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
    const actualTopScorerId = topEntry(goalsByPlayer);
    const actualTopAssistId = topEntry(assistsByPlayer);

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

      if (actualTopScorerId && pred.top_scorer_player_id === actualTopScorerId) {
        const tier = await getPlayerTier(supabase, actualTopScorerId, season.id);
        await award("season_top_scorer", tierPointsMap.get(tier) ?? 150);
      }
      if (actualTopAssistId && pred.top_assist_player_id === actualTopAssistId) {
        const tier = await getPlayerTier(supabase, actualTopAssistId, season.id);
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

function topEntry(counts: Map<number, number>): number | null {
  let bestId: number | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  }
  return bestId;
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
