export interface PointConfig {
  /** Bonus fixe ajouté au-dessus du "bon résultat" quand le score exact est trouvé — jamais scalé
   * par la cote (contrairement au bon résultat lui-même), pour rester une récompense de précision
   * constante quel que soit l'écart de niveau entre les deux équipes. */
  matchExactScoreBonus: number;
  matchCorrectResultNoScore: number;
  seasonPositionExact: number;
  seasonPositionPresence: number;
  seasonSurpriseTeam: number;
  seasonFlopTeam: number;
  /** Pronostic finale (coupe à élimination directe, ex: Ligue des Champions) : par finaliste
   * correctement deviné (jusqu'à 2), puis bonus si le vainnqueur est aussi le bon. */
  seasonFinalTeam: number;
  seasonFinalWinner: number;
}

/** Bon résultat (victoire/nul/défaite) trouvé, indépendamment du score exact — scalé par la cote
 * via applyResultOdds côté appelant (le nul n'a pas de "camp", donc jamais scalé, voir cette
 * fonction). Le score exact ajoute son propre bonus fixe par-dessus, voir computeExactScoreBonus. */
export function computeMatchResultPoints(
  predictedHome: number,
  predictedAway: number,
  actualHome: number,
  actualAway: number,
  config: PointConfig
): number {
  const predictedResult = Math.sign(predictedHome - predictedAway);
  const actualResult = Math.sign(actualHome - actualAway);
  return predictedResult === actualResult ? config.matchCorrectResultNoScore : 0;
}

/** Bonus fixe pour un score exact, en plus du bon résultat — jamais scalé par la cote (précision
 * pure), 0 si le bon résultat lui-même n'est pas trouvé (un score exact implique toujours un bon
 * résultat, mais le vérifier explicitement évite tout résultat surprenant si jamais ce n'était
 * pas le cas). */
export function computeExactScoreBonus(
  predictedHome: number,
  predictedAway: number,
  actualHome: number,
  actualAway: number,
  config: PointConfig
): number {
  return predictedHome === actualHome && predictedAway === actualAway ? config.matchExactScoreBonus : 0;
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

/**
 * "Garantie buteur/passeur" : un pronostic sur un joueur remplacé en cours de match reste validé
 * si c'est son remplaçant qui marque/passe à sa place — sur tous les matchs, pas seulement celui
 * du joueur pronostiqué lui-même. `substituteByPlayer` associe le joueur SORTANT à celui ENTRANT
 * à sa place (voir match_substitutions) ; un seul niveau de remplacement, pas de chaîne.
 */
export function predictionCoveredByPlayer(
  predictedPlayerId: number | null,
  actualPlayers: ReadonlySet<number>,
  substituteByPlayer: ReadonlyMap<number, number>
): boolean {
  if (predictedPlayerId == null) return false;
  if (actualPlayers.has(predictedPlayerId)) return true;
  const substitute = substituteByPlayer.get(predictedPlayerId);
  return substitute != null && actualPlayers.has(substitute);
}

/** 1 = équipes proches au classement, 5 = écart de niveau important. */
export type OddsTier = 1 | 2 | 3 | 4 | 5;

export interface ResultTierMultiplier {
  favoriteMultiplierPct: number;
  underdogMultiplierPct: number;
  /** Un nul contre un favori plus fort est déjà un petit exploit pour l'outsider — entre la
   * valeur "favori" et la valeur "outsider" du même tier, jamais figé à une seule valeur quel
   * que soit l'écart de niveau (voir migration 0046). */
  drawMultiplierPct: number;
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
 * rapporte plus qu'un pronostic gagnant sur le favori "logique", et un nul est lui aussi scalé
 * (plus l'écart de niveau est grand, plus un nul rapporte — voir drawMultiplierPct). Sans tier
 * connu (début de saison, historique insuffisant) les points de base ne sont pas modifiés ; sans
 * favori connu mais avec un tier, seul le cas "victoire" reste non scalé (impossible de dire qui
 * est favori/outsider), le nul l'est quand même.
 */
export function applyResultOdds(
  basePoints: number,
  winnerTeamId: number | null,
  favoriteTeamId: number | null,
  tier: OddsTier | null,
  multiplierByTier: Map<OddsTier, ResultTierMultiplier>
): number {
  if (basePoints <= 0 || tier === null) return basePoints;
  const mult = multiplierByTier.get(tier);
  if (!mult) return basePoints;
  if (winnerTeamId === null) return Math.round((basePoints * mult.drawMultiplierPct) / 100);
  if (favoriteTeamId === null) return basePoints;
  const pct = winnerTeamId === favoriteTeamId ? mult.favoriteMultiplierPct : mult.underdogMultiplierPct;
  return Math.round((basePoints * pct) / 100);
}
