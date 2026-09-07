const BASE_URL = "https://soccer.highlightly.net";

/**
 * Highlightly — utilisé uniquement pour récupérer les events but/passe de chaque match
 * (football-data.org ne les fournit pas). Plan gratuit 100 requêtes/jour, sans carte bancaire.
 * /matches?date= liste tous les matchs mondiaux d'un jour donné, paginés par 100 : on filtre
 * par leagueId pour rester sous la pagination et ne récupérer que nos 5 championnats.
 */
async function highlightlyFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const apiKey = process.env.HIGHLIGHTLY_API_KEY;
  if (!apiKey) {
    throw new Error("HIGHLIGHTLY_API_KEY manquante dans les variables d'environnement");
  }

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    headers: { "x-rapidapi-key": apiKey },
    cache: "no-store",
    // Idem football-data : un appel qui traîne ne doit pas pouvoir épuiser tout le budget du cron.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Highlightly ${path} a échoué: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export interface HlMatch {
  id: number;
  league: { id: number };
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
}

export interface HlEvent {
  time: string;
  team: { id: number; name: string };
  // Pour un but : buteur. Pour un remplacement : joueur SORTANT (vérifié en croisant plusieurs
  // remplacements d'un vrai match contre les données ESPN du même match — jamais documenté par
  // Highlightly lui-même). Nullable : constaté null sur un remplacement précis d'un vrai match,
  // sans qu'on sache pourquoi (source tierce, pas notre bug).
  player: string | null;
  playerId: number | null;
  // Pour un but : passeur éventuel. Pour un remplacement, ce champ ne sert pas — le joueur
  // ENTRANT est porté par `substituted` (nom seul, pas d'id disponible côté Highlightly pour lui).
  assist: string | null;
  assistingPlayerId: number | null;
  /** Joueur ENTRANT d'un remplacement (nom seul). Absent/non pertinent pour tout autre type d'event. */
  substituted?: string | null;
  type: "Goal" | "Yellow Card" | "Red Card" | "Substitution" | "Var";
}

export const highlightly = {
  /** Tous les matchs d'un championnat donné (id Highlightly) pour une date donnée. */
  getMatchesByDate: (date: string, leagueId: number) =>
    highlightlyFetch<{ data: HlMatch[] }>("/matches", { date, leagueId }).then((r) => r.data),

  /** Events (buts + passes décisives, cartons...) d'un match donné. */
  getMatchEvents: (matchId: number) => highlightlyFetch<HlEvent[]>(`/events/${matchId}`),
};
