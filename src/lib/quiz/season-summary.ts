export interface SeasonLeaderboardRow {
  userId: string;
  username: string;
  avatarUrl: string | null;
  totalScore: number;
  daysPlayed: number;
}

/** Agrège des lignes quiz_results (user_id, score) en classement trié par total décroissant.
 * Pure, aucun accès réseau — extraite hors de src/app/quiz/actions.ts ("use server") car une
 * fonction non-async en tête d'un tel fichier y casse silencieusement toutes les actions au
 * runtime (invisible à tsc/eslint/build, seulement au premier appel client réel). */
export function summarizeQuizResults(
  results: Array<{ user_id: string; score: number }>,
  profileById: Map<string, { username: string; avatar_url: string | null }>
): SeasonLeaderboardRow[] {
  const totals = new Map<string, { total: number; days: number }>();
  for (const r of results) {
    const cur = totals.get(r.user_id) ?? { total: 0, days: 0 };
    cur.total += r.score;
    cur.days += 1;
    totals.set(r.user_id, cur);
  }
  return [...totals.entries()]
    .map(([userId, t]) => ({
      userId,
      username: profileById.get(userId)?.username ?? "?",
      avatarUrl: profileById.get(userId)?.avatar_url ?? null,
      totalScore: t.total,
      daysPlayed: t.days,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
}
