import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { LEAGUE_FLAG, LEAGUE_COLOR } from "@/lib/country-flags";

// Même fenêtre que /api/cron/live-tick : un match "finished" reste visible ici un moment après
// coup de sifflet final plutôt que de disparaître instantanément du bandeau.
const WINDOW_MS = 150 * 60 * 1000;

export interface LiveMatchGoal {
  minute: number | null;
  scorerName: string;
  assistName: string | null;
  teamSide: "home" | "away";
}

export interface LiveMatchDto {
  id: number;
  status: "live" | "finished";
  kickoffAt: string;
  liveClock: string | null;
  leagueCode: string;
  leagueFlag: string;
  leagueColor: string;
  homeTeamName: string;
  awayTeamName: string;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  homeScore: number | null;
  awayScore: number | null;
  goals: LiveMatchGoal[];
}

/** Liste des matchs en cours (+ tout juste terminés) pour le bandeau "En direct" — partagée entre
 * la page d'accueil (rendu initial côté serveur) et /api/live-matches (polling client). */
export async function getLiveMatches(supabase: SupabaseClient<Database>): Promise<LiveMatchDto[]> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: matches } = await supabase
    .from("matches")
    .select("id, season_id, home_team_id, away_team_id, status, home_score, away_score, live_clock, kickoff_at")
    .in("status", ["live", "finished"])
    .gt("kickoff_at", windowStart)
    .order("kickoff_at", { ascending: true });

  if (!matches || matches.length === 0) return [];

  const seasonIds = [...new Set(matches.map((m) => m.season_id))];
  const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const matchIds = matches.map((m) => m.id);

  const [{ data: seasons }, { data: teams }, { data: goals }] = await Promise.all([
    supabase.from("seasons").select("id, league_id").in("id", seasonIds),
    supabase.from("teams").select("id, name, logo_url").in("id", teamIds),
    supabase
      .from("match_goals")
      .select("match_id, team_id, minute, player_id, assist_player_id")
      .in("match_id", matchIds)
      .order("minute", { ascending: true }),
  ]);

  const leagueIdBySeasonId = new Map((seasons ?? []).map((s) => [s.id, s.league_id]));
  const leagueIds = [...new Set([...leagueIdBySeasonId.values()])];
  const { data: leagues } = await supabase.from("leagues").select("id, football_data_code").in("id", leagueIds);
  const leagueCodeById = new Map((leagues ?? []).map((l) => [l.id, l.football_data_code]));
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  const playerIds = [
    ...new Set((goals ?? []).flatMap((g) => [g.player_id, g.assist_player_id].filter((id): id is number => id != null))),
  ];
  const { data: players } = playerIds.length > 0
    ? await supabase.from("players").select("id, name").in("id", playerIds)
    : { data: [] };
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const goalsByMatchId = new Map<number, LiveMatchGoal[]>();
  for (const g of goals ?? []) {
    const match = matches.find((m) => m.id === g.match_id);
    if (!goalsByMatchId.has(g.match_id)) goalsByMatchId.set(g.match_id, []);
    goalsByMatchId.get(g.match_id)!.push({
      minute: g.minute,
      scorerName: g.player_id != null ? (playerNameById.get(g.player_id) ?? "?") : "But contre son camp",
      assistName: g.assist_player_id != null ? (playerNameById.get(g.assist_player_id) ?? null) : null,
      teamSide: match && g.team_id === match.home_team_id ? "home" : "away",
    });
  }

  return matches.map((m) => {
    const leagueId = leagueIdBySeasonId.get(m.season_id);
    const leagueCode = leagueId != null ? leagueCodeById.get(leagueId) : undefined;
    const home = teamById.get(m.home_team_id);
    const away = teamById.get(m.away_team_id);
    return {
      id: m.id,
      status: m.status as "live" | "finished",
      kickoffAt: m.kickoff_at,
      liveClock: m.live_clock,
      leagueCode: leagueCode ?? "",
      leagueFlag: leagueCode ? (LEAGUE_FLAG[leagueCode] ?? "") : "",
      leagueColor: leagueCode ? (LEAGUE_COLOR[leagueCode] ?? "#888") : "#888",
      homeTeamName: home?.name ?? "?",
      awayTeamName: away?.name ?? "?",
      homeLogoUrl: home?.logo_url ?? null,
      awayLogoUrl: away?.logo_url ?? null,
      homeScore: m.home_score,
      awayScore: m.away_score,
      goals: (goalsByMatchId.get(m.id) ?? []).sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0)),
    };
  });
}
