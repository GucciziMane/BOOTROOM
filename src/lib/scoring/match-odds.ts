import type { OddsTier } from "./points";

export interface TeamStanding {
  teamId: number;
  played: number; // matchs joués cette saison
  points: number; // points cette saison
  priorPpg: number | null; // points/match de la saison précédente (repli division inférieure inclus), si connu
}

export interface MatchOdds {
  favoriteTeamId: number | null;
  tier: OddsTier | null;
}

// Poids du classement de la saison précédente, exprimé en "matchs virtuels" de la saison en
// cours : au fil des matchs réellement joués, son influence s'estompe naturellement au profit
// de la forme actuelle (repose sur points/match, comparables entre les deux échelles).
const PRIOR_WEIGHT_GAMES = 10;

// Cutoffs d'écart de points par match jouée (échelle 0 à 3) entre les deux équipes.
const GAP_CUTOFFS: [number, number, number, number] = [0.3, 0.7, 1.1, 1.6];

/** Points/match "effectif", mélange du classement précédent et de la saison en cours. */
function effectivePpg(standing: TeamStanding): number | null {
  if (standing.priorPpg === null && standing.played === 0) return null;
  const priorPoints = (standing.priorPpg ?? 0) * PRIOR_WEIGHT_GAMES;
  const priorGames = standing.priorPpg !== null ? PRIOR_WEIGHT_GAMES : 0;
  return (priorPoints + standing.points) / (priorGames + standing.played);
}

/**
 * Favori + ampleur de l'écart entre deux équipes. Dès le premier match de la saison, s'appuie
 * sur le classement de la saison précédente (une équipe sans historique dans la division est
 * supposée aussi faible que la lanterne rouge de l'an dernier) ; l'influence de ce prior
 * s'efface progressivement à mesure que les résultats de la saison en cours s'accumulent.
 */
export function computeMatchOdds(home: TeamStanding, away: TeamStanding): MatchOdds {
  const homePpg = effectivePpg(home);
  const awayPpg = effectivePpg(away);
  if (homePpg === null || awayPpg === null || homePpg === awayPpg) {
    return { favoriteTeamId: null, tier: null };
  }

  const gap = Math.abs(homePpg - awayPpg);
  const [c1, c2, c3, c4] = GAP_CUTOFFS;
  const tier: OddsTier = gap <= c1 ? 1 : gap <= c2 ? 2 : gap <= c3 ? 3 : gap <= c4 ? 4 : 5;
  const favoriteTeamId = homePpg > awayPpg ? home.teamId : away.teamId;
  return { favoriteTeamId, tier };
}
