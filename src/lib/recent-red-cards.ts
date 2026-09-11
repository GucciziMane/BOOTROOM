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
