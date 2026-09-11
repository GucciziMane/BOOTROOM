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
const POSITION_TAG: Record<Position, string> = {
  Goalkeeper: "G",
  Defender: "D",
  Midfielder: "M",
  Attacker: "A",
};

/**
 * Groupe par équipe (comme avant), un groupe par équipe — mais les joueurs y sont triés par poste
 * (gardien/défenseur/milieu/attaquant) plutôt qu'alphabétiquement, avec une courte étiquette de
 * poste devant chaque nom : un <select> HTML n'autorise qu'un seul niveau d'<optgroup> (impossible
 * d'imbriquer "équipe > poste"), donc les sous-parties par poste sont rendues à l'intérieur de
 * l'optgroup de chaque équipe via cet ordre + cette étiquette plutôt qu'un vrai sous-groupe.
 */
export function groupPlayersByPosition(
  homePlayers: Array<{ id: number; name: string; position: Position }>,
  homeTeamName: string,
  awayPlayers: Array<{ id: number; name: string; position: Position }>,
  awayTeamName: string,
  /** Joueurs expulsés lors du dernier match joué par leur équipe (voir recent-red-cards.ts) —
   * signalés dans le libellé, pas exclus : un carton rouge n'entraîne pas toujours une suspension
   * pour LE prochain match précis (compétition différente, appel...), donc on affiche le fait
   * plutôt que d'affirmer une indisponibilité qu'on ne peut pas garantir. */
  recentlyRedCardedPlayerIds: ReadonlySet<number> = new Set()
): PositionGroup[] {
  const buildGroup = (players: Array<{ id: number; name: string; position: Position }>, teamName: string): PositionGroup => ({
    label: teamName,
    options: [...players]
      .sort((a, b) => {
        const positionDiff = POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position);
        return positionDiff !== 0 ? positionDiff : a.name.localeCompare(b.name);
      })
      .map((p) => ({
        id: p.id,
        label: `${POSITION_TAG[p.position]} · ${p.name}${recentlyRedCardedPlayerIds.has(p.id) ? " — 🟥 dernier match" : ""}`,
      })),
  });

  return [buildGroup(homePlayers, homeTeamName), buildGroup(awayPlayers, awayTeamName)].filter(
    (group) => group.options.length > 0
  );
}
