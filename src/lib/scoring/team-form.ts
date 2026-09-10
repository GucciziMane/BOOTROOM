export type FormResult = "W" | "D" | "L";

export interface FinishedMatchForForm {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  kickoffAt: string;
}

/** Forme récente d'une équipe : résultat (victoire/nul/défaite) de ses `limit` derniers matchs
 * terminés, du plus ancien au plus récent (lecture gauche -> droite, le plus récent à droite). */
export function computeTeamForm(matches: FinishedMatchForForm[], teamId: number, limit = 3): FormResult[] {
  return matches
    .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
    .slice(0, limit)
    .reverse()
    .map((m) => {
      const isHome = m.homeTeamId === teamId;
      const teamScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      if (teamScore > oppScore) return "W";
      if (teamScore < oppScore) return "L";
      return "D";
    });
}
