/** Points par place bien devinée dans le top 10 du Ballon d'Or — contrairement à
 * computeSeasonPositionPoints (top3/bottom3 saison), pas de bonus "présence" pour une place
 * approximative : seule la place exacte rapporte, avec un barème croissant vers le sommet. */
export const BALLON_DOR_RANK_POINTS: Record<number, number> = {
  1: 50,
  2: 30,
  3: 20,
  4: 20,
  5: 20,
  6: 10,
  7: 10,
  8: 10,
  9: 10,
  10: 10,
};

/**
 * `picks` : pronostic d'un joueur, clés "1".."10" -> nominee_id (voir ballon_dor_predictions.picks).
 * `actual` : résultat réel, rang 1..10 -> nominee_id (ou null si ce rang n'a pas encore de
 * gagnant confirmé — voir ballon_dor_editions.rank_N_nominee_id).
 */
export function computeBallonDorPoints(picks: Record<string, number>, actual: Record<number, number | null>): number {
  let total = 0;
  for (let rank = 1; rank <= 10; rank++) {
    const predicted = picks[String(rank)];
    if (predicted != null && actual[rank] != null && predicted === actual[rank]) {
      total += BALLON_DOR_RANK_POINTS[rank];
    }
  }
  return total;
}
