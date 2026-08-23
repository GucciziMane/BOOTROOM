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
