import type { createClient } from "@/lib/supabase/server";
import { matchPlayerByName } from "@/lib/sync/name-match";

export interface FinishedMatchForCards {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: string;
}

/** Pour chaque équipe de `teamIds`, l'id de son match terminé le plus récent (parmi
 * `finishedMatches` — à l'appelant de l'avoir déjà filtré aux matchs antérieurs à celui affiché,
 * comme pour computeTeamForm). Sert de base à "carton rouge lors du DERNIER match de l'équipe". */
export function getMostRecentFinishedMatchIdByTeam(
  finishedMatches: FinishedMatchForCards[],
  teamIds: number[]
): Map<number, number> {
  const result = new Map<number, number>();
  for (const teamId of teamIds) {
    const latest = finishedMatches
      .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))[0];
    if (latest) result.set(teamId, latest.id);
  }
  return result;
}

/**
 * Cartons rouges du dernier match de chaque équipe, résolus vers l'id ACTIF du joueur (voir
 * players.left_at) — pas simplement match_cards.player_id tel quel. Même club/joueur suivi sous
 * plusieurs lignes (une par championnat, ex: PSG en Ligue 1 ET en Ligue des Champions — incident
 * Ferrán Torres du 13/09/2026) : un carton enregistré contre une fiche depuis marquée "partie" ne
 * matchait plus jamais aucun joueur affiché (homePlayers/awayPlayers filtrent .is("left_at",
 * null)), faisant disparaître le badge silencieusement plutôt que de suivre le joueur vers sa
 * fiche active actuelle.
 */
export async function resolveRecentRedCardedPlayerIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchIds: number[],
  activePlayers: Array<{ id: number; name: string; team_id: number }>
): Promise<number[]> {
  if (matchIds.length === 0) return [];

  const { data: cards } = await supabase
    .from("match_cards")
    .select("player_id, team_id")
    .eq("card_type", "red")
    .in("match_id", matchIds);
  const rawIds = [...new Set((cards ?? []).map((c) => c.player_id).filter((id): id is number => id != null))];
  if (rawIds.length === 0) return [];

  const activeIds = new Set(activePlayers.map((p) => p.id));
  const resolved = new Set(rawIds.filter((id) => activeIds.has(id)));
  const stillMissing = rawIds.filter((id) => !activeIds.has(id));
  if (stillMissing.length === 0) return [...resolved];

  const { data: departedRows } = await supabase.from("players").select("id, name, team_id").in("id", stillMissing);
  const activeByTeam = new Map<number, Array<{ id: number; name: string }>>();
  for (const p of activePlayers) {
    if (!activeByTeam.has(p.team_id)) activeByTeam.set(p.team_id, []);
    activeByTeam.get(p.team_id)!.push(p);
  }
  for (const dep of departedRows ?? []) {
    const match = matchPlayerByName(dep.name, activeByTeam.get(dep.team_id) ?? []);
    if (match) resolved.add(match.id);
  }
  return [...resolved];
}
