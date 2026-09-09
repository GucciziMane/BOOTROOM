import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  computeMatchResultPoints,
  computeExactScoreBonus,
  computeSeasonPositionPoints,
  resolveScorerTierPoints,
  resolveAssistTierPoints,
  predictedWinnerTeamId,
  applyResultOdds,
  predictionCoveredByPlayer,
  FALLBACK_SCORER_TIER,
  type PointConfig,
  type OddsTier,
  type ResultTierMultiplier,
} from "@/lib/scoring/points";
import { computeStandings } from "@/lib/scoring/standings";
import { postMatchdayRecaps } from "@/lib/chat/matchday-recap";
import type { PointsSourceType } from "@/types/database";

const MAX_MATCHES_PER_RUN = 100;
// Délai laissé à la sync des buteurs (API-Football) avant de traiter un match quand même :
// si la clé API-Football est invalide/en panne, on ne veut pas bloquer indéfiniment les points
// de score (qui n'en dépendent pas) en attendant des buteurs qui ne viendront jamais.
const EVENTS_SYNC_GRACE_MS = 6 * 60 * 60 * 1000;

export type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export async function loadPointConfig(supabase: ServiceClient): Promise<PointConfig> {
  const { data } = await supabase.from("point_config").select("key, points");
  const map = new Map((data ?? []).map((r) => [r.key, r.points]));
  return {
    matchExactScoreBonus: map.get("match_exact_score") ?? 20,
    matchCorrectResultNoScore: map.get("match_correct_result_no_score") ?? 50,
    seasonPositionExact: map.get("season_position_exact") ?? 50,
    seasonPositionPresence: map.get("season_position_presence") ?? 15,
    seasonSurpriseTeam: map.get("season_surprise_team") ?? 40,
    seasonFlopTeam: map.get("season_flop_team") ?? 40,
    seasonFinalTeam: map.get("season_final_team") ?? 40,
    seasonFinalWinner: map.get("season_final_winner") ?? 60,
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const config = await loadPointConfig(supabase);

  const matchesResult = await processFinishedMatches(supabase, config);
  const seasonsResult = await processFinishedSeasons(supabase, config);

  // QStash/le monitoring ne peuvent détecter un échec réel du traitement (upsert points_ledger en
  // erreur, etc.) que via le statut HTTP : processFinishedMatches/processFinishedSeasons portaient
  // déjà l'erreur dans leur champ `error`, mais la réponse restait 200 quoi qu'il arrive. Un
  // `processed: 0` sans `error` (aucun match/saison à traiter ce run) reste un succès métier normal.
  const failed = ("error" in matchesResult && Boolean(matchesResult.error)) || ("error" in seasonsResult && Boolean(seasonsResult.error));

  return NextResponse.json({ matches: matchesResult, seasons: seasonsResult }, failed ? { status: 500 } : undefined);
}

/**
 * `matchIdsFilter` : appelé depuis live-tick juste après avoir synchronisé les buts d'un match qui
 * vient de passer "finished", pour lui donner ses points tout de suite plutôt que d'attendre le
 * prochain passage de ce cron (jusqu'à 30 min) — la garde events_synced_at/délai de grâce
 * s'applique quand même, mais live-tick pose events_synced_at avant d'appeler cette fonction.
 */
export async function processFinishedMatches(supabase: ServiceClient, config: PointConfig, matchIdsFilter?: number[]) {
  const eventsSyncDeadline = new Date(Date.now() - EVENTS_SYNC_GRACE_MS).toISOString();

  let query = supabase
    .from("matches")
    .select(
      "id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, favorite_team_id, odds_tier, matchday"
    )
    .eq("status", "finished")
    .is("points_processed_at", null)
    .or(`events_synced_at.not.is.null,kickoff_at.lt.${eventsSyncDeadline}`)
    .limit(MAX_MATCHES_PER_RUN);
  if (matchIdsFilter) query = query.in("id", matchIdsFilter);
  const { data: matches, error } = await query;

  if (error || !matches || matches.length === 0) {
    return { processed: 0, error: error?.message };
  }

  const { data: tierPoints } = await supabase.from("match_scorer_tier_points").select("tier, points");
  const tierPointsMap = new Map((tierPoints ?? []).map((t) => [t.tier, t.points]));

  const { data: assistTierPoints } = await supabase.from("match_assist_tier_points").select("tier, points");
  const assistTierPointsMap = new Map((assistTierPoints ?? []).map((t) => [t.tier, t.points]));

  const { data: resultMultipliers } = await supabase
    .from("match_result_tier_multipliers")
    .select("tier, favorite_multiplier_pct, underdog_multiplier_pct, draw_multiplier_pct");
  const resultMultiplierMap = new Map<OddsTier, ResultTierMultiplier>(
    (resultMultipliers ?? []).map((r) => [
      r.tier,
      {
        favoriteMultiplierPct: r.favorite_multiplier_pct,
        underdogMultiplierPct: r.underdog_multiplier_pct,
        drawMultiplierPct: r.draw_multiplier_pct,
      },
    ])
  );

  const finishedMatches = matches.filter((m) => m.home_score !== null && m.away_score !== null);
  if (finishedMatches.length === 0) return { processed: 0 };

  const matchIds = finishedMatches.map((m) => m.id);
  const seasonIds = [...new Set(finishedMatches.map((m) => m.season_id))];

  // Tout précalculé en 5 requêtes groupées plutôt que jusqu'à 5 requêtes PAR match (+ jusqu'à 2
  // de plus par pronostic) : à MAX_MATCHES_PER_RUN=100 matchs et quelques amis chacun, l'ancienne
  // version pouvait dépasser le millier d'allers-retours DB séquentiels dans un seul run de cron.
  const [{ data: allPredictions }, { data: allGoals }, { data: allSubs }, { data: existingLedger }, { data: scorerTierRows }, { data: assistTierRows }] =
    await Promise.all([
      supabase
        .from("match_predictions")
        .select(
          "id, match_id, user_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id, predicted_assist_player_id, is_doubled"
        )
        .in("match_id", matchIds),
      supabase.from("match_goals").select("match_id, player_id, assist_player_id").in("match_id", matchIds),
      supabase.from("match_substitutions").select("match_id, player_out_id, player_in_id").in("match_id", matchIds),
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
  // "Garantie buteur/passeur" (voir predictionCoveredByPlayer) : joueur sortant -> entrant, par match.
  const substituteByMatch = new Map<number, Map<number, number>>();
  for (const s of allSubs ?? []) {
    if (s.player_out_id == null || s.player_in_id == null) continue;
    if (!substituteByMatch.has(s.match_id)) substituteByMatch.set(s.match_id, new Map());
    substituteByMatch.get(s.match_id)!.set(s.player_out_id, s.player_in_id);
  }

  const alreadyAwarded = new Set((existingLedger ?? []).map((r) => `${r.source_id}:${r.user_id}:${r.source_type}`));
  // Un même joueur n'a qu'un seul tier par saison en pratique (une seule ligue à la fois) : la clé
  // ne porte que sur player_id, pas besoin du season_id ici contrairement à une lecture par match.
  const scorerTierByPlayer = new Map((scorerTierRows ?? []).map((r) => [r.player_id, r.tier]));
  const assistTierByPlayer = new Map((assistTierRows ?? []).map((r) => [r.player_id, r.tier]));

  // Garde défensive contre une course entre la sélection initiale (plus haut, points_processed_at
  // is null) et l'écriture plus bas : un run concurrent (double planification, retry, live-tick
  // sur le même match) a pu marquer points_processed_at entre-temps, pendant les calculs
  // ci-dessus. Re-vérifié ici, juste avant de construire les écritures, pour réduire au minimum
  // la fenêtre de course plutôt que de se fier à la sélection devenue potentiellement obsolète.
  // Un double paiement était déjà exclu par la contrainte unique de points_ledger (onConflict +
  // ignoreDuplicates plus bas, migration 0024) — cette garde évite en plus tout travail inutile
  // (recalcul, réécriture de match_predictions/points_processed_at) sur un match déjà traité.
  const { data: stillUnprocessed } = await supabase
    .from("matches")
    .select("id")
    .in("id", matchIds)
    .is("points_processed_at", null);
  const stillUnprocessedIds = new Set((stillUnprocessed ?? []).map((m) => m.id));
  const matchesToProcess = finishedMatches.filter((m) => stillUnprocessedIds.has(m.id));
  if (matchesToProcess.length === 0) return { processed: 0 };

  const ledgerInserts: Array<{ user_id: string; league_id: number; source_type: PointsSourceType; source_id: number; points: number }> = [];
  const predictionUpdates: Array<{
    id: number;
    user_id: string;
    match_id: number;
    predicted_home_score: number;
    predicted_away_score: number;
    points_awarded: number;
  }> = [];

  for (const match of matchesToProcess) {
    const homeScore = match.home_score as number;
    const awayScore = match.away_score as number;
    const actualScorers = scorersByMatch.get(match.id) ?? new Set();
    const actualAssisters = assistersByMatch.get(match.id) ?? new Set();
    const substituteByPlayer = substituteByMatch.get(match.id) ?? new Map();

    for (const pred of predictionsByMatch.get(match.id) ?? []) {
      const baseResultPoints = computeMatchResultPoints(
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
      const resultPoints = applyResultOdds(
        baseResultPoints,
        winnerTeamId,
        match.favorite_team_id,
        match.odds_tier,
        resultMultiplierMap
      );
      // Bonus de précision fixe, jamais scalé par la cote (contrairement au bon résultat
      // ci-dessus) — voir computeExactScoreBonus.
      const exactScoreBonus = computeExactScoreBonus(
        pred.predicted_home_score,
        pred.predicted_away_score,
        homeScore,
        awayScore,
        config
      );
      const scorePoints = resultPoints + exactScoreBonus;

      const scorerPoints = predictionCoveredByPlayer(pred.predicted_scorer_player_id, actualScorers, substituteByPlayer)
        ? resolveScorerTierPoints(scorerTierByPlayer.get(pred.predicted_scorer_player_id!), tierPointsMap)
        : 0;
      const assistPoints = predictionCoveredByPlayer(pred.predicted_assist_player_id, actualAssisters, substituteByPlayer)
        ? resolveAssistTierPoints(assistTierByPlayer.get(pred.predicted_assist_player_id!), assistTierPointsMap)
        : 0;

      // x2 : un seul par (utilisateur, championnat, journée), choisi par le pronostiqueur — voir
      // saveMatchPrediction pour la validation qui garantit qu'il n'y en a jamais deux actifs à la
      // fois pour la même journée. Double tout ce que ce match rapporte (score, buteur, passeur).
      const multiplier = pred.is_doubled ? 2 : 1;
      const finalScorePoints = scorePoints * multiplier;
      const finalScorerPoints = scorerPoints * multiplier;
      const finalAssistPoints = assistPoints * multiplier;

      const toAward: Array<[PointsSourceType, number]> = [
        ["match_score", finalScorePoints],
        ["match_scorer", finalScorerPoints],
        ["match_assist", finalAssistPoints],
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
        points_awarded: finalScorePoints + finalScorerPoints + finalAssistPoints,
      });
    }
  }

  // upsert + ignoreDuplicates plutôt qu'insert : un INSERT multi-lignes est une seule instruction
  // atomique en PostgreSQL, donc un conflit sur une seule ligne (deux runs concurrents qui se
  // chevauchent, cf. la double planification supprimée par ailleurs) aurait fait échouer tout le
  // lot silencieusement. Avec ignoreDuplicates, un conflit sur points_ledger_user_source_unique
  // (migration 0024) devient un DO NOTHING par ligne — la première attribution gagne, comme le
  // filtre alreadyAwarded ci-dessus l'exprime déjà côté application.
  let ledgerError: string | undefined;
  if (ledgerInserts.length > 0) {
    const { error } = await supabase
      .from("points_ledger")
      .upsert(ledgerInserts, { onConflict: "user_id,source_type,source_id", ignoreDuplicates: true });
    ledgerError = error?.message;
  }

  let predictionError: string | undefined;
  if (predictionUpdates.length > 0) {
    const { error } = await supabase.from("match_predictions").upsert(predictionUpdates, { onConflict: "id" });
    predictionError = error?.message;
  }

  // points_processed_at ne doit JAMAIS être posé si une des deux écritures ci-dessus a échoué :
  // la requête qui sélectionne les matchs à traiter (plus haut) filtre sur points_processed_at is
  // null, donc un match marqué à tort ne serait plus jamais repris par aucun run futur — perte
  // silencieuse et définitive des points de tout le lot. En cas d'erreur, on ne marque rien : le
  // prochain run retentera l'intégralité du lot, sans risque de doublon grâce à ignoreDuplicates.
  if (ledgerError || predictionError) {
    return { processed: 0, error: ledgerError ?? predictionError };
  }

  const matchIdsToProcess = matchesToProcess.map((m) => m.id);
  await supabase
    .from("matches")
    .update({ points_processed_at: new Date().toISOString() })
    .in("id", matchIdsToProcess)
    // Condition atomique en plus du filtre applicatif ci-dessus : même si un run concurrent a
    // traité l'un de ces matchs dans la toute petite fenêtre entre la re-vérification et cette
    // écriture, Postgres n'y touche pas une deuxième fois (déjà non nul).
    .is("points_processed_at", null);

  const touchedMatchdayGroups = matchesToProcess
    .filter((m): m is typeof m & { matchday: number } => m.matchday != null)
    .map((m) => ({ seasonId: m.season_id, leagueId: m.league_id, matchday: m.matchday }));
  await postMatchdayRecaps(supabase, touchedMatchdayGroups);

  return { processed: matchesToProcess.length };
}

async function processFinishedSeasons(supabase: ServiceClient, config: PointConfig) {
  const { data: seasons, error } = await supabase
    .from("seasons")
    .select("id, league_id, actual_surprise_team_id, actual_flop_team_id")
    .eq("status", "finished");

  if (error || !seasons || seasons.length === 0) {
    return { processed: 0, error: error?.message };
  }

  // Ligue des Champions : pas de flop3/équipe surprise/équipe flop (pas de sens pour une coupe à
  // élimination directe) — à la place, un pronostic finale (2 finalistes + vainqueur), résolu
  // automatiquement depuis le match "FINAL" de la saison plutôt qu'une saisie admin comme
  // actual_surprise_team_id/actual_flop_team_id (voir plus bas).
  const { data: leaguesData } = await supabase
    .from("leagues")
    .select("id, football_data_code")
    .in("id", [...new Set(seasons.map((s) => s.league_id))]);
  const leagueCodeById = new Map((leaguesData ?? []).map((l) => [l.id, l.football_data_code]));

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

    const isCup = leagueCodeById.get(season.league_id) === "CL";

    // Coupe à élimination directe : le seul match qui compte pour "finaliste"/"vainqueur" est
    // celui de stage "FINAL" — voir la synthèse de journée pour les tours à élimination directe
    // dans /api/cron/sync-fixtures. Un match encore null/pas fini = rien à récompenser pour
    // l'instant, comme actual_surprise_team_id/actual_flop_team_id pas encore renseignés.
    let actualFinalists: number[] = [];
    let actualWinnerTeamId: number | null = null;
    if (isCup) {
      const { data: finalMatch } = await supabase
        .from("matches")
        .select("home_team_id, away_team_id, home_score, away_score, penalty_winner_team_id")
        .eq("season_id", season.id)
        .eq("stage", "FINAL")
        .eq("status", "finished")
        .maybeSingle();
      if (finalMatch && finalMatch.home_score !== null && finalMatch.away_score !== null) {
        actualFinalists = [finalMatch.home_team_id, finalMatch.away_team_id];
        // penalty_winner_team_id (O5) prioritaire quand renseigné : home_score/away_score stocke
        // désormais le score du match hors tirs au but (voir sync-fixtures/resolveMatchScore),
        // donc une finale décidée aux tirs au but y est à égalité — jamais déduire ce vainqueur du
        // score, seule la colonne explicite fait foi.
        actualWinnerTeamId =
          finalMatch.penalty_winner_team_id ??
          (finalMatch.home_score > finalMatch.away_score
            ? finalMatch.home_team_id
            : finalMatch.away_score > finalMatch.home_score
              ? finalMatch.away_team_id
              : null);
      }
    }

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
        "season_final_team",
        "season_final_winner",
      ]);
    const alreadyAwarded = new Set((existingLedger ?? []).map((r) => `${r.user_id}:${r.source_type}`));

    const { data: predictions } = await supabase
      .from("season_predictions")
      .select(
        "user_id, top_scorer_player_id, top_assist_player_id, top3, bottom3, surprise_team_id, flop_team_id, final_team_a_id, final_team_b_id, final_winner_team_id"
      )
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

      if (isCup) {
        if (actualFinalists.length > 0) {
          const predictedFinalists: Array<number | null> = [pred.final_team_a_id, pred.final_team_b_id];
          let finalTeamPoints = 0;
          for (const teamId of predictedFinalists) {
            if (teamId != null && actualFinalists.includes(teamId)) finalTeamPoints += config.seasonFinalTeam;
          }
          await award("season_final_team", finalTeamPoints);
        }
        if (actualWinnerTeamId && pred.final_winner_team_id === actualWinnerTeamId) {
          await award("season_final_winner", config.seasonFinalWinner);
        }
      } else {
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
    }

    const fullyResolved = isCup
      ? actualFinalists.length > 0
      : Boolean(season.actual_surprise_team_id && season.actual_flop_team_id);
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
