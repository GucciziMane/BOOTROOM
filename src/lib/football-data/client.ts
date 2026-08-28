const BASE_URL = "https://api.football-data.org/v4";

/**
 * football-data.org — source principale (équipes, effectifs, calendrier, résultats,
 * classements). Plan gratuit : 10 requêtes/minute, sans restriction de saison, pour
 * ces 5 championnats. À n'appeler que depuis les jobs de sync, jamais côté navigateur.
 */
async function footballDataFetch<T>(path: string): Promise<T> {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) {
    throw new Error("FOOTBALL_DATA_API_KEY manquante dans les variables d'environnement");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": token },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`football-data.org ${path} a échoué: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export interface FdSquadPlayer {
  id: number;
  name: string;
  position: "Goalkeeper" | "Defence" | "Midfield" | "Offence" | null;
}

export interface FdTeam {
  id: number;
  name: string;
  crest: string;
  squad: FdSquadPlayer[];
}

export interface FdCompetitionTeamsResponse {
  count: number;
  teams: FdTeam[];
}

export interface FdSeason {
  id: number;
  startDate: string;
  endDate: string;
  currentMatchday: number | null;
}

export interface FdCompetition {
  id: number;
  code: string;
  name: string;
  currentSeason: FdSeason;
}

export type FdMatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "FINISHED"
  | "POSTPONED"
  | "SUSPENDED"
  | "CANCELLED"
  | "AWARDED";

export interface FdMatch {
  id: number;
  utcDate: string;
  status: FdMatchStatus;
  matchday: number | null;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  score: { fullTime: { home: number | null; away: number | null } };
}

export interface FdCompetitionMatchesResponse {
  matches: FdMatch[];
}

export interface FdStandingRow {
  position: number;
  team: { id: number; name: string };
  playedGames: number;
  points: number;
}

export interface FdStandingsResponse {
  standings: Array<{ type: "TOTAL" | "HOME" | "AWAY"; table: FdStandingRow[] }>;
}

export const footballData = {
  getCompetition: (code: string) => footballDataFetch<FdCompetition>(`/competitions/${code}`),

  /** Un seul appel donne toutes les équipes ET leurs effectifs complets. */
  getCompetitionTeams: (code: string) =>
    footballDataFetch<FdCompetitionTeamsResponse>(`/competitions/${code}/teams`),

  getCompetitionMatches: (code: string) =>
    footballDataFetch<FdCompetitionMatchesResponse>(`/competitions/${code}/matches`),

  /** `season` (année de début, ex: 2025) permet de récupérer le classement d'une saison passée. */
  getStandings: (code: string, season?: number) =>
    footballDataFetch<FdStandingsResponse>(`/competitions/${code}/standings${season ? `?season=${season}` : ""}`),
};

/** Poste football-data.org -> poste normalisé utilisé dans notre schéma. */
export function normalizePosition(
  fdPosition: FdSquadPlayer["position"]
): "Goalkeeper" | "Defender" | "Midfielder" | "Attacker" {
  switch (fdPosition) {
    case "Goalkeeper":
      return "Goalkeeper";
    case "Defence":
      return "Defender";
    case "Midfield":
      return "Midfielder";
    case "Offence":
    default:
      return "Attacker";
  }
}

/** Statut football-data.org -> statut normalisé utilisé dans notre schéma. */
export function normalizeMatchStatus(
  status: FdMatchStatus
): "scheduled" | "live" | "finished" | "postponed" | "cancelled" {
  switch (status) {
    case "SCHEDULED":
    case "TIMED":
      return "scheduled";
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    case "FINISHED":
    case "AWARDED":
      return "finished";
    case "POSTPONED":
      return "postponed";
    case "SUSPENDED":
    case "CANCELLED":
      return "cancelled";
  }
}
