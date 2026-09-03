import type { createClient } from "@/lib/supabase/server";
import { computeStandings, type MatchResult } from "@/lib/scoring/standings";
import type { Position } from "@/types/database";

type SupaClient = Awaited<ReturnType<typeof createClient>>;

export interface ClubHomeStandingRow {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  position: number;
  points: number;
}

export interface ClubHomeStanding {
  position: number;
  totalTeams: number;
  points: number;
  played: number;
  form: ("W" | "D" | "L")[];
  leagueName: string;
  leagueCode: string;
  tableWindow: ClubHomeStandingRow[];
}

export interface ClubHomeMatch {
  id: number;
  opponentName: string;
  opponentLogoUrl: string | null;
  isHome: boolean;
  kickoffAt: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface ClubHomePlayer {
  id: number;
  name: string;
  position: Position;
  photoUrl: string | null;
}

export interface ClubHomeData {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  standing: ClubHomeStanding | null;
  nextMatch: ClubHomeMatch | null;
  lastResult: ClubHomeMatch | null;
  squad: ClubHomePlayer[];
}

const POSITION_ORDER: Record<Position, number> = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Attacker: 3 };

/** Toutes les données réelles (classement, prochain match, dernier résultat, effectif) pour la
 * page d'accueil "club favori" — aucune donnée inventée, tout vient des tables déjà synchronisées. */
export async function getClubHomeData(supabase: SupaClient, teamId: number): Promise<ClubHomeData | null> {
  const { data: team } = await supabase
    .from("teams")
    .select("id, name, league_id, logo_url, primary_color, secondary_color")
    .eq("id", teamId)
    .maybeSingle();

  if (!team?.primary_color) return null;

  // Ni l'une ni l'autre ne dépend du résultat de l'autre (toutes deux ne demandent que
  // team.league_id) : lancées en parallèle plutôt qu'à la suite.
  const [{ data: league }, { data: seasons }] = await Promise.all([
    supabase.from("leagues").select("name, football_data_code").eq("id", team.league_id).maybeSingle(),
    supabase.from("seasons").select("id").eq("league_id", team.league_id).order("year", { ascending: false }).limit(1),
  ]);
  const seasonId = seasons?.[0]?.id as number | undefined;

  const [{ data: leagueTeams }, { data: seasonMatches }, { data: nextMatchRow }, { data: lastResultRow }, { data: squadRows }] =
    await Promise.all([
      supabase.from("teams").select("id, name, logo_url").eq("league_id", team.league_id),
      seasonId
        ? supabase
            .from("matches")
            .select("home_team_id, away_team_id, home_score, away_score, status, kickoff_at")
            .eq("season_id", seasonId)
        : Promise.resolve({ data: null }),
      supabase
        .from("matches")
        .select("id, home_team_id, away_team_id, kickoff_at")
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .in("status", ["scheduled", "live"])
        .order("kickoff_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("matches")
        .select("id, home_team_id, away_team_id, kickoff_at, home_score, away_score")
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("players").select("id, name, position, photo_url").eq("team_id", teamId).is("left_at", null),
    ]);

  const teamsById = new Map((leagueTeams ?? []).map((t) => [t.id, t]));

  const toClubMatch = (row: {
    id: number;
    home_team_id: number;
    away_team_id: number;
    kickoff_at: string;
    home_score?: number | null;
    away_score?: number | null;
  }): ClubHomeMatch | null => {
    const isHome = row.home_team_id === teamId;
    const opponentId = isHome ? row.away_team_id : row.home_team_id;
    const opponent = teamsById.get(opponentId);
    if (!opponent) return null;
    return {
      id: row.id,
      opponentName: opponent.name,
      opponentLogoUrl: opponent.logo_url,
      isHome,
      kickoffAt: row.kickoff_at,
      homeScore: row.home_score ?? null,
      awayScore: row.away_score ?? null,
    };
  };

  let standing: ClubHomeStanding | null = null;
  if (league && seasonMatches) {
    const finished = seasonMatches.filter(
      (m) => m.status === "finished" && m.home_score !== null && m.away_score !== null
    );
    const matchResults: MatchResult[] = finished.map((m) => ({
      homeTeamId: m.home_team_id,
      awayTeamId: m.away_team_id,
      homeScore: m.home_score as number,
      awayScore: m.away_score as number,
    }));
    const table = computeStandings(matchResults, [...teamsById.keys()]);
    const rank = table.findIndex((r) => r.teamId === teamId);
    const row = table[rank];
    if (row) {
      const form = finished
        .filter((m) => m.home_team_id === teamId || m.away_team_id === teamId)
        .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))
        .slice(0, 5)
        .map((m): "W" | "D" | "L" => {
          const isHome = m.home_team_id === teamId;
          const forGoals = isHome ? (m.home_score as number) : (m.away_score as number);
          const againstGoals = isHome ? (m.away_score as number) : (m.home_score as number);
          if (forGoals > againstGoals) return "W";
          if (forGoals < againstGoals) return "L";
          return "D";
        })
        .reverse();

      const windowRadius = 2;
      const windowStart = Math.max(0, Math.min(rank - windowRadius, table.length - (windowRadius * 2 + 1)));
      const tableWindow: ClubHomeStandingRow[] = table
        .slice(windowStart, windowStart + windowRadius * 2 + 1)
        .map((r, i) => {
          const t = teamsById.get(r.teamId);
          return { teamId: r.teamId, teamName: t?.name ?? "?", logoUrl: t?.logo_url ?? null, position: windowStart + i + 1, points: r.points };
        });

      standing = {
        position: rank + 1,
        totalTeams: table.length,
        points: row.points,
        played: row.played,
        form,
        leagueName: league.name,
        leagueCode: league.football_data_code,
        tableWindow,
      };
    }
  }

  const squad = (squadRows ?? [])
    .map((p) => ({ id: p.id, name: p.name, position: p.position as Position, photoUrl: p.photo_url }))
    .sort((a, b) => POSITION_ORDER[a.position] - POSITION_ORDER[b.position] || a.name.localeCompare(b.name));

  return {
    teamId: team.id,
    teamName: team.name,
    logoUrl: team.logo_url,
    primaryColor: team.primary_color,
    secondaryColor: team.secondary_color,
    standing,
    nextMatch: nextMatchRow ? toClubMatch(nextMatchRow) : null,
    lastResult: lastResultRow ? toClubMatch(lastResultRow) : null,
    squad,
  };
}
