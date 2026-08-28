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
  player: string;
  playerId: number;
  assist: string | null;
  assistingPlayerId: number | null;
  type: "Goal" | "Yellow Card" | "Red Card" | "Substitution" | "Var";
}

export const highlightly = {
  /** Tous les matchs d'un championnat donné (id Highlightly) pour une date donnée. */
  getMatchesByDate: (date: string, leagueId: number) =>
    highlightlyFetch<{ data: HlMatch[] }>("/matches", { date, leagueId }).then((r) => r.data),

  /** Events (buts + passes décisives, cartons...) d'un match donné. */
  getMatchEvents: (matchId: number) => highlightlyFetch<HlEvent[]>(`/events/${matchId}`),
};
