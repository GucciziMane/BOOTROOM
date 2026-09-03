import type { Position } from "@/types/database";

export type ScoringTier = 1 | 2 | 3 | 4 | 5; // 1 = très probable, 5 = très improbable

const MIN_MINUTES_FOR_STATS = 180;

// Cutoffs de percentile cumulés pour les tiers 1 à 4 (le reste va en tier 5).
// Reflète la réalité du foot : peu de buteurs/passeurs prolifiques, beaucoup de joueurs qui
// contribuent rarement.
const TIER_PERCENTILE_CUTOFFS: [number, number, number, number] = [0.05, 0.2, 0.5, 0.8];

interface TierInput {
  playerId: number;
  position: Position;
  statPer90: number | null; // null si pas assez de minutes jouées pour être significatif
  minutesPlayed: number;
}

/** Classe des joueurs en 5 tiers de probabilité selon un stat/90min + un prior de poste en repli
 * pour les faibles échantillons. Partagé par les tiers buteur et passeur (voir plus bas). */
function computeTiers(players: TierInput[], positionPrior: Record<Position, number>): Map<number, ScoringTier> {
  const compositeScore = (player: TierInput): number => {
    if (player.minutesPlayed >= MIN_MINUTES_FOR_STATS && player.statPer90 !== null) {
      return player.statPer90;
    }
    // Faible échantillon : on retombe sur le prior de poste, avec une décote pour ne pas
    // surclasser un titulaire remplaçant face à un titulaire confirmé.
    return positionPrior[player.position] * 0.3;
  };

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

export interface ScoringTierInput {
  playerId: number;
  position: Position;
  goalsPer90: number | null;
  minutesPlayed: number;
}

// Reflète la probabilité de marquer selon le poste, utilisé en repli faute d'échantillon.
const SCORER_POSITION_PRIOR: Record<Position, number> = {
  Attacker: 0.5,
  Midfielder: 0.25,
  Defender: 0.08,
  Goalkeeper: 0.01,
};

/**
 * Classe tous les joueurs d'un championnat en 5 tiers de probabilité de marquer,
 * en combinant poste et forme récente (buts/90min). Recalculé à chaque sync hebdo.
 * Un attaquant en forme finit en tier 1 (peu de points s'il est pronostiqué buteur),
 * un défenseur finit en tier 4/5 (beaucoup de points si le pari est gagné).
 */
export function computeScoringTiers(players: ScoringTierInput[]): Map<number, ScoringTier> {
  return computeTiers(
    players.map((p) => ({ ...p, statPer90: p.goalsPer90 })),
    SCORER_POSITION_PRIOR
  );
}

export interface AssistTierInput {
  playerId: number;
  position: Position;
  assistsPer90: number | null;
  minutesPlayed: number;
}

// Les postes créatifs (milieux, puis attaquants qui se trouvent entre eux) contribuent le plus de
// passes décisives ; à l'inverse du prior buteur, les défenseurs (couloirs, centres) ne sont pas
// loin derrière les attaquants.
const ASSIST_POSITION_PRIOR: Record<Position, number> = {
  Midfielder: 0.35,
  Attacker: 0.3,
  Defender: 0.12,
  Goalkeeper: 0.01,
};

/** Même principe que computeScoringTiers, mais pour la probabilité de passe décisive. */
export function computeAssistTiers(players: AssistTierInput[]): Map<number, ScoringTier> {
  return computeTiers(
    players.map((p) => ({ ...p, statPer90: p.assistsPer90 })),
    ASSIST_POSITION_PRIOR
  );
}
