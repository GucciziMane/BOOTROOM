export interface MatchResult {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
}

export interface StandingRow {
  teamId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** Classement calculé à partir des résultats de matchs (points, puis diff de buts, puis buts marqués). */
export function computeStandings(matches: MatchResult[], teamIds: number[]): StandingRow[] {
  const table = new Map<number, StandingRow>(
    teamIds.map((id) => [
      id,
      { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, goalDifference: 0, goalsFor: 0, goalsAgainst: 0 },
    ])
  );

  for (const m of matches) {
    const home = table.get(m.homeTeamId);
    const away = table.get(m.awayTeamId);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += m.homeScore;
    away.goalsFor += m.awayScore;
    home.goalsAgainst += m.awayScore;
    away.goalsAgainst += m.homeScore;
    home.goalDifference += m.homeScore - m.awayScore;
    away.goalDifference += m.awayScore - m.homeScore;

    if (m.homeScore > m.awayScore) {
      home.points += 3;
      home.won++;
      away.lost++;
    } else if (m.homeScore < m.awayScore) {
      away.points += 3;
      away.won++;
      home.lost++;
    } else {
      home.points += 1;
      away.points += 1;
      home.drawn++;
      away.drawn++;
    }
  }

  return [...table.values()].sort(
    (a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
}
