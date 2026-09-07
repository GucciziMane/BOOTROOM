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
  /** Minute affichée par ESPN pendant le direct (ex: "63'", "45'+2'"), null hors match live. */
  displayClock: string | null;
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
      status: { type: { name: string }; displayClock?: string };
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

    const status = normalizeEspnStatus(comp.status.type.name);
    return [
      {
        id: event.id,
        date: event.date,
        status,
        displayClock: status === "live" ? (comp.status.displayClock ?? null) : null,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore: home.score !== undefined ? Number(home.score) : null,
        awayScore: away.score !== undefined ? Number(away.score) : null,
      },
    ];
  });
}

export interface EspnGoal {
  teamName: string;
  scorerName: string;
  assistName: string | null;
  minute: number | null;
}

interface EspnSummaryResponse {
  keyEvents?: Array<{
    type: { type: string };
    scoringPlay?: boolean;
    team?: { displayName: string };
    clock?: { displayValue: string };
    participants?: Array<{ athlete: { displayName: string } }>;
  }>;
}

/** Buts (buteur + passeur éventuel) d'un match précis, via son id d'événement ESPN. */
export async function getEspnMatchGoals(leagueSlug: string, eventId: string): Promise<EspnGoal[]> {
  const data = await espnFetch<EspnSummaryResponse>(`/${leagueSlug}/summary?event=${eventId}`);

  return (data.keyEvents ?? []).flatMap((e) => {
    // ESPN distingue le TYPE de but ("goal", "goal---header", "goal---volley", "own-goal",
    // "penalty---scored"...) : ne retenir que le libellé exact "goal" en ignorait la plupart en
    // silence (confirmé sur un match réel : le seul but d'un 1-0 était "goal---header", donc
    // jamais enregistré, et n'importe quel pronostic buteur/passeur sur ce match était compté
    // perdant à tort). "scoringPlay" est le champ qu'ESPN pose lui-même sur TOUT événement qui
    // change le score, quel que soit son type exact — bien plus robuste qu'une liste de libellés
    // à maintenir à la main.
    if (!e.scoringPlay || !e.team || !e.participants || e.participants.length === 0) return [];
    const minuteMatch = e.clock?.displayValue?.match(/\d+/);
    return [
      {
        teamName: e.team.displayName,
        scorerName: e.participants[0].athlete.displayName,
        assistName: e.participants[1]?.athlete.displayName ?? null,
        minute: minuteMatch ? Number(minuteMatch[0]) : null,
      },
    ];
  });
}
