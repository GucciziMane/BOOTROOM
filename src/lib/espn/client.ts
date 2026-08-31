const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/**
 * Endpoint non-officiel d'ESPN (pas de clé, pas de limite documentée, largement utilisé par des
 * petits projets pour ça) : sert uniquement à rafraîchir statut + score des matchs récents,
 * football-data.org (gratuit) restant la source pour le calendrier complet/effectifs/saison —
 * voir sync-fixtures pour le pourquoi (leur "livescore" gratuit est volontairement décalé,
 * confirmé dans leur propre grille tarifaire, pas un bug chez nous).
 */
async function espnFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`ESPN ${path} a échoué: ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Nos 5 championnats -> slug de compétition ESPN. */
export const ESPN_LEAGUE_SLUG: Record<string, string> = {
  FL1: "fra.1",
  PL: "eng.1",
  PD: "esp.1",
  BL1: "ger.1",
  PPL: "por.1",
};

export interface EspnEvent {
  id: string;
  date: string;
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

interface EspnScoreboardResponse {
  events?: Array<{
    id: string;
    date: string;
    competitions: Array<{
      status: { type: { name: string } };
      competitors: Array<{
        homeAway: "home" | "away";
        score?: string;
        team: { displayName: string };
      }>;
    }>;
  }>;
}

function normalizeEspnStatus(name: string): EspnEvent["status"] {
  switch (name) {
    case "STATUS_SCHEDULED":
    case "STATUS_TBD":
      return "scheduled";
    case "STATUS_IN_PROGRESS":
    case "STATUS_HALFTIME":
    case "STATUS_FIRST_HALF":
    case "STATUS_SECOND_HALF":
    case "STATUS_END_PERIOD":
      return "live";
    case "STATUS_FULL_TIME":
    case "STATUS_FINAL":
      return "finished";
    case "STATUS_POSTPONED":
      return "postponed";
    case "STATUS_CANCELED":
    case "STATUS_ABANDONED":
    case "STATUS_SUSPENDED":
      return "cancelled";
    default:
      // Statut ESPN pas encore vu (nouveau libellé) : on ignore ce match plutôt que de deviner.
      return "scheduled";
  }
}

/** Tous les matchs d'un championnat sur une plage de dates (incluse), au format YYYYMMDD-YYYYMMDD. */
export async function getEspnScoreboard(leagueSlug: string, fromYmd: string, toYmd: string): Promise<EspnEvent[]> {
  const data = await espnFetch<EspnScoreboardResponse>(
    `/${leagueSlug}/scoreboard?dates=${fromYmd}-${toYmd}&limit=200`
  );

  return (data.events ?? []).flatMap((event) => {
    const comp = event.competitions[0];
    if (!comp) return [];
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) return [];

    return [
      {
        id: event.id,
        date: event.date,
        status: normalizeEspnStatus(comp.status.type.name),
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore: home.score !== undefined ? Number(home.score) : null,
        awayScore: away.score !== undefined ? Number(away.score) : null,
      },
    ];
  });
}
