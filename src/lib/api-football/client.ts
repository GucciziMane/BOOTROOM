const BASE_URL = "https://v3.football.api-sports.io";

/**
 * API-Football — utilisé uniquement pour récupérer les events but/passe de chaque match
 * (football-data.org ne les fournit pas). Le plan gratuit bloque les endpoints filtrés par
 * saison pour la saison en cours (/fixtures?league=&season=, /players?...), mais PAS une
 * recherche par date seule (/fixtures?date=) : on découvre donc les matchs du jour via la
 * date, on filtre côté client sur nos 5 championnats, puis on interroge /fixtures/events.
 * 100 requêtes/jour, 10/minute : à n'appeler que depuis les jobs de sync.
 */
async function apiFootballFetch<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY manquante dans les variables d'environnement");
  }

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    headers: { "x-apisports-key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API-Football ${path} a échoué: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { response: T; errors: unknown };
  const hasErrors = Array.isArray(json.errors) ? json.errors.length > 0 : Boolean(json.errors && Object.keys(json.errors).length);
  if (hasErrors) {
    throw new Error(`API-Football ${path} a renvoyé des erreurs: ${JSON.stringify(json.errors)}`);
  }

  return json.response;
}

export interface AfFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}

export interface AfEvent {
  time: { elapsed: number };
  team: { id: number; name: string };
  player: { id: number; name: string };
  assist: { id: number | null; name: string | null };
  type: "Goal" | "Card" | "subst" | "Var";
  detail: string;
}

export const apiFootball = {
  /** Tous les matchs (tous championnats confondus) d'une date donnée — pas de restriction de saison. */
  getFixturesByDate: (date: string) => apiFootballFetch<AfFixture[]>("/fixtures", { date }),

  /** Events (buts + passes décisives, cartons...) d'un match donné. */
  getFixtureEvents: (fixtureId: number) => apiFootballFetch<AfEvent[]>("/fixtures/events", { fixture: fixtureId }),
};
