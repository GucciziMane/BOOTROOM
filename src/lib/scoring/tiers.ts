import type { Position } from "@/types/database";

export interface ScoringTierInput {
  playerId: number;
  position: Position;
  goalsPer90: number | null; // null si pas assez de minutes jouées pour être significatif
  minutesPlayed: number;
}

export type ScoringTier = 1 | 2 | 3 | 4 | 5; // 1 = très probable buteur, 5 = très improbable

const MIN_MINUTES_FOR_STATS = 180;

// Prior utilisé quand un joueur n'a pas encore assez de minutes jouées cette saison
// (ex: tout début de saison) : reflète la probabilité de marquer selon le poste.
const POSITION_PRIOR: Record<Position, number> = {
  Attacker: 0.5,
  Midfielder: 0.25,
  Defender: 0.08,
  Goalkeeper: 0.01,
};

// Cutoffs de percentile cumulés pour les tiers 1 à 4 (le reste va en tier 5).
// Reflète la réalité du foot : peu de buteurs prolifiques, beaucoup de joueurs qui marquent rarement.
const TIER_PERCENTILE_CUTOFFS: [number, number, number, number] = [0.05, 0.2, 0.5, 0.8];

function compositeScore(player: ScoringTierInput): number {
  if (player.minutesPlayed >= MIN_MINUTES_FOR_STATS && player.goalsPer90 !== null) {
    return player.goalsPer90;
  }
  // Faible échantillon : on retombe sur le prior de poste, avec une décote pour
  // ne pas surclasser un attaquant remplaçant face à un titulaire confirmé.
  return POSITION_PRIOR[player.position] * 0.3;
}

/**
 * Classe tous les joueurs d'un championnat en 5 tiers de probabilité de marquer,
 * en combinant poste et forme récente (buts/90min). Recalculé à chaque sync hebdo.
 * Un attaquant en forme finit en tier 1 (peu de points s'il est pronostiqué buteur),
 * un défenseur finit en tier 4/5 (beaucoup de points si le pari est gagné).
 */
export function computeScoringTiers(players: ScoringTierInput[]): Map<number, ScoringTier> {
  const scored = players
    .map((player) => ({ id: player.playerId, score: compositeScore(player) }))
    .sort((a, b) => b.score - a.score);

  const tiers = new Map<number, ScoringTier>();
  const total = scored.length;

  scored.forEach((entry, index) => {
    const percentile = (index + 1) / total;
    const [c1, c2, c3, c4] = TIER_PERCENTILE_CUTOFFS;
    let tier: ScoringTier;
    if (percentile <= c1) tier = 1;
    else if (percentile <= c2) tier = 2;
    else if (percentile <= c3) tier = 3;
    else if (percentile <= c4) tier = 4;
    else tier = 5;
    tiers.set(entry.id, tier);
  });

  return tiers;
}
