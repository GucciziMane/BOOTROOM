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
  // Un championnat désactivé (ex: Bundesliga, Primeira Liga) garde ses données et continue d'être
  // suivi en base, mais ne doit plus jamais réapparaître à l'écran — y compris ici, sans quoi un de
  // ses matchs qui se joue "en douce" ressurgirait dans le bandeau "en direct".
  const { data: activeLeagues } = await supabase.from("leagues").select("id, football_data_code").eq("active", true);
  const activeLeagueIds = (activeLeagues ?? []).map((l) => l.id);
  const leagueCodeById = new Map((activeLeagues ?? []).map((l) => [l.id, l.football_data_code]));
  if (activeLeagueIds.length === 0) return [];

  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: matches } = await supabase
    .from("matches")
    .select("id, league_id, home_team_id, away_team_id, status, home_score, away_score, live_clock, kickoff_at")
    .in("status", ["live", "finished"])
    .in("league_id", activeLeagueIds)
    .gt("kickoff_at", windowStart)
    .order("kickoff_at", { ascending: true });

  if (!matches || matches.length === 0) return [];

  const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const matchIds = matches.map((m) => m.id);

  const [{ data: teams }, { data: goals }] = await Promise.all([
    supabase.from("teams").select("id, name, logo_url").in("id", teamIds),
    supabase
      .from("match_goals")
      .select("match_id, team_id, minute, player_id, assist_player_id, scorer_name, assist_name")
      .in("match_id", matchIds)
      .order("minute", { ascending: true }),
  ]);
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
      // player_id null : but contre son camp, ou joueur pas encore synchronisé (transfert récent)
      // — dans les deux cas on affiche le nom brut fourni par la source plutôt que de perdre le
      // but (voir migration 0039), "?" restant un dernier repli pour d'anciennes lignes antérieures
      // à cette migration qui n'auraient ni l'un ni l'autre.
      scorerName: g.player_id != null ? (playerNameById.get(g.player_id) ?? g.scorer_name ?? "?") : (g.scorer_name ?? "?"),
      assistName:
        g.assist_player_id != null ? (playerNameById.get(g.assist_player_id) ?? g.assist_name ?? null) : g.assist_name,
      teamSide: match && g.team_id === match.home_team_id ? "home" : "away",
    });
  }

  return matches.map((m) => {
    const leagueCode = leagueCodeById.get(m.league_id);
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
