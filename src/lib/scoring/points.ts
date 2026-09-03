export interface PointConfig {
  matchExactScore: number;
  matchCorrectResultNoScore: number;
  seasonPositionExact: number;
  seasonPositionPresence: number;
  seasonSurpriseTeam: number;
  seasonFlopTeam: number;
}

/** Score exact = plein pot, bon résultat (victoire/nul/défaite) sans le score = petit bonus. */
export function computeMatchScorePoints(
  predictedHome: number,
  predictedAway: number,
  actualHome: number,
  actualAway: number,
  config: PointConfig
): number {
  if (predictedHome === actualHome && predictedAway === actualAway) return config.matchExactScore;
  const predictedResult = Math.sign(predictedHome - predictedAway);
  const actualResult = Math.sign(actualHome - actualAway);
  return predictedResult === actualResult ? config.matchCorrectResultNoScore : 0;
}

/** Position exacte dans le trio (top3/bottom3) = plein pot, présence dans le trio = bonus réduit. */
export function computeSeasonPositionPoints(
  predictedTeamId: number | null | undefined,
  predictedRank: number,
  actualTrioTeamIds: number[],
  config: PointConfig
): number {
  if (!predictedTeamId) return 0;
  if (actualTrioTeamIds[predictedRank - 1] === predictedTeamId) return config.seasonPositionExact;
  return actualTrioTeamIds.includes(predictedTeamId) ? config.seasonPositionPresence : 0;
}

/** Tier utilisé quand aucun tier n'a encore été calculé pour un joueur (3 = probabilité moyenne). */
export const FALLBACK_SCORER_TIER = 3;
const FALLBACK_SCORER_TIER_POINTS = 40;

/** Points buteur si le joueur pronostiqué marque, selon son tier (repli sur le tier moyen si non calculé). */
export function resolveScorerTierPoints(tier: number | null | undefined, tierPointsMap: Map<number, number>): number {
  return tierPointsMap.get(tier ?? FALLBACK_SCORER_TIER) ?? FALLBACK_SCORER_TIER_POINTS;
}

/** Tier utilisé quand aucun tier n'a encore été calculé pour un joueur (3 = probabilité moyenne). */
export const FALLBACK_ASSIST_TIER = 3;
const FALLBACK_ASSIST_TIER_POINTS = 28;

/** Points passeur si le joueur pronostiqué délivre la passe décisive, selon son tier. */
export function resolveAssistTierPoints(tier: number | null | undefined, tierPointsMap: Map<number, number>): number {
  return tierPointsMap.get(tier ?? FALLBACK_ASSIST_TIER) ?? FALLBACK_ASSIST_TIER_POINTS;
}

/** 1 = équipes proches au classement, 5 = écart de niveau important. */
export type OddsTier = 1 | 2 | 3 | 4 | 5;

export interface ResultTierMultiplier {
  favoriteMultiplierPct: number;
  underdogMultiplierPct: number;
}

/** Équipe désignée vainqueur par le pronostic (score prédit), ou null si nul pronostiqué. */
export function predictedWinnerTeamId(
  predictedHome: number,
  predictedAway: number,
  homeTeamId: number,
  awayTeamId: number
): number | null {
  if (predictedHome === predictedAway) return null;
  return predictedHome > predictedAway ? homeTeamId : awayTeamId;
}

/**
 * Ajuste les points de score selon la cote du match : un pronostic gagnant sur l'outsider
 * rapporte plus qu'un pronostic gagnant sur le favori "logique". Sans favori connu (début de
 * saison, ou équipes trop proches) ou pronostic nul, les points de base ne sont pas modifiés.
 */
export function applyResultOdds(
  basePoints: number,
  winnerTeamId: number | null,
  favoriteTeamId: number | null,
  tier: OddsTier | null,
  multiplierByTier: Map<OddsTier, ResultTierMultiplier>
): number {
  if (basePoints <= 0 || winnerTeamId === null || favoriteTeamId === null || tier === null) return basePoints;
  const mult = multiplierByTier.get(tier);
  if (!mult) return basePoints;
  const pct = winnerTeamId === favoriteTeamId ? mult.favoriteMultiplierPct : mult.underdogMultiplierPct;
  return Math.round((basePoints * pct) / 100);
}
