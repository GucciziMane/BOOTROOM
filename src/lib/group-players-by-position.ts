import type { Position } from "@/types/database";

export interface PositionOption {
  id: number;
  label: string;
}

export interface PositionGroup {
  label: string;
  options: PositionOption[];
}

const POSITION_ORDER: Position[] = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];
const POSITION_LABEL: Record<Position, string> = {
  Goalkeeper: "Gardiens",
  Defender: "Défenseurs",
  Midfielder: "Milieux",
  Attacker: "Attaquants",
};

/**
 * Regroupe les effectifs des deux équipes par poste (gardien/défenseur/milieu/attaquant) plutôt
 * que par équipe : un <select> HTML n'autorise qu'un seul niveau d'<optgroup> (impossible
 * d'imbriquer "équipe > poste"), donc le poste devient le groupe et le nom de l'équipe est ajouté
 * entre parenthèses à chaque option pour rester capable de distinguer les deux effectifs.
 */
export function groupPlayersByPosition(
  homePlayers: Array<{ id: number; name: string; position: Position }>,
  homeTeamName: string,
  awayPlayers: Array<{ id: number; name: string; position: Position }>,
  awayTeamName: string
): PositionGroup[] {
  const tagged = [
    ...homePlayers.map((p) => ({ ...p, teamName: homeTeamName })),
    ...awayPlayers.map((p) => ({ ...p, teamName: awayTeamName })),
  ];
  return POSITION_ORDER.map((position) => ({
    label: POSITION_LABEL[position],
    options: tagged
      .filter((p) => p.position === position)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: `${p.name} (${p.teamName})` })),
  })).filter((group) => group.options.length > 0);
}
