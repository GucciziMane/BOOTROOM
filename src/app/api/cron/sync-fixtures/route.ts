import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { footballData, normalizeMatchStatus } from "@/lib/football-data/client";
import { apiFootball, type AfFixture } from "@/lib/api-football/client";
import { teamNamesMatch, matchPlayerByName } from "@/lib/sync/name-match";
import { computeStandings } from "@/lib/scoring/standings";
import { computeMatchOdds } from "@/lib/scoring/match-odds";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_EVENT_CALLS_PER_RUN = 80; // reste sous le quota de 100 req/jour d'API-Football

/**
 * Sync quotidien : calendrier + résultats (football-data.org), puis pour les matchs
 * fraîchement terminés, récupération des buteurs/passeurs (API-Football, par date).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const { data: leagues, error: leaguesError } = await supabase
    .from("leagues")
    .select("id, football_data_code, api_football_id");

  if (leaguesError || !leagues) {
    return NextResponse.json({ error: leaguesError?.message ?? "leagues introuvables" }, { status: 500 });
  }

  const matchesSummary: Array<{ league: string; matches: number; error?: string }> = [];

  for (const league of leagues) {
    try {
      const { data: seasons } = await supabase
        .from("seasons")
        .select("id, year")
        .eq("league_id", league.id)
        .order("year", { ascending: false })
        .limit(1);
      const seasonId = seasons?.[0]?.id;
      if (!seasonId) throw new Error("aucune saison synchronisée — lancer sync-teams-players d'abord");

      const { data: teams } = await supabase.from("teams").select("id, football_data_id").eq("league_id", league.id);
      const teamIdByFdId = new Map((teams ?? []).map((t) => [t.football_data_id, t.id]));

      const { matches } = await footballData.getCompetitionMatches(league.football_data_code);

      const rows = matches.flatMap((m) => {
        const homeTeamId = teamIdByFdId.get(m.homeTeam.id);
        const awayTeamId = teamIdByFdId.get(m.awayTeam.id);
        if (!homeTeamId || !awayTeamId) return [];
        return [
          {
            league_id: league.id,
            season_id: seasonId,
            football_data_id: m.id,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            kickoff_at: m.utcDate,
            status: normalizeMatchStatus(m.status),
            home_score: m.score.fullTime.home,
            away_score: m.score.fullTime.away,
          },
        ];
      });

      const { error: upsertError } = await supabase
        .from("matches")
        .upsert(rows, { onConflict: "football_data_id" });
      if (upsertError) throw new Error(upsertError.message);

      await updateMatchOdds(supabase, seasonId);

      matchesSummary.push({ league: league.football_data_code, matches: rows.length });
      await sleep(700);
    } catch (err) {
      matchesSummary.push({
        league: league.football_data_code,
        matches: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const eventsSummary = await syncGoalEvents(supabase, leagues);

  return NextResponse.json({ matches: matchesSummary, events: eventsSummary });
}

/**
 * Recalcule le favori + l'écart de niveau (odds_tier) de chaque match pas encore joué de la
 * saison, à partir du classement courant (matchs terminés). Suit donc l'avancée du
 * championnat : un promu qui s'installe en haut de tableau redevient favori au fil des matchs.
 */
async function updateMatchOdds(supabase: ReturnType<typeof createServiceRoleClient>, seasonId: number) {
  const { data: seasonMatches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, status, home_score, away_score")
    .eq("season_id", seasonId);
  if (!seasonMatches || seasonMatches.length === 0) return;

  const teamIds = [...new Set(seasonMatches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const { data: teamsData } = await supabase.from("teams").select("id, prior_ppg").in("id", teamIds);
  const priorPpgByTeam = new Map((teamsData ?? []).map((t) => [t.id, t.prior_ppg]));

  const finishedResults = seasonMatches
    .filter((m) => m.status === "finished" && m.home_score !== null && m.away_score !== null)
    .map((m) => ({
      homeTeamId: m.home_team_id,
      awayTeamId: m.away_team_id,
      homeScore: m.home_score as number,
      awayScore: m.away_score as number,
    }));
  const standingByTeam = new Map(
    computeStandings(finishedResults, teamIds).map((s) => [
      s.teamId,
      { teamId: s.teamId, played: s.played, points: s.points, priorPpg: priorPpgByTeam.get(s.teamId) ?? null },
    ])
  );

  const updates = seasonMatches
    .filter((m) => m.status === "scheduled" || m.status === "live")
    .flatMap((m) => {
      const home = standingByTeam.get(m.home_team_id);
      const away = standingByTeam.get(m.away_team_id);
      if (!home || !away) return [];
      const odds = computeMatchOdds(home, away);
      return [{ id: m.id, favorite_team_id: odds.favoriteTeamId, odds_tier: odds.tier }];
    });

  for (const u of updates) {
    await supabase
      .from("matches")
      .update({ favorite_team_id: u.favorite_team_id, odds_tier: u.odds_tier })
      .eq("id", u.id);
  }
}

async function syncGoalEvents(
  supabase: ReturnType<typeof createServiceRoleClient>,
  leagues: Array<{ id: number; football_data_code: string; api_football_id: number }>
) {
  const apiFootballLeagueIds = new Set(leagues.map((l) => l.api_football_id));

  const { data: pendingMatches, error } = await supabase
    .from("matches")
    .select("id, league_id, home_team_id, away_team_id, kickoff_at")
    .eq("status", "finished")
    .is("events_synced_at", null)
    .limit(MAX_EVENT_CALLS_PER_RUN);

  if (error || !pendingMatches || pendingMatches.length === 0) {
    return { processed: 0, matched: 0, unmatched: 0, error: error?.message };
  }

  const teamIds = [...new Set(pendingMatches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const { data: players } = await supabase.from("players").select("id, name, team_id").in("team_id", teamIds);
  const playersByTeamId = new Map<number, Array<{ id: number; name: string }>>();
  for (const p of players ?? []) {
    if (!playersByTeamId.has(p.team_id)) playersByTeamId.set(p.team_id, []);
    playersByTeamId.get(p.team_id)!.push({ id: p.id, name: p.name });
  }

  const fixturesByDateCache = new Map<string, AfFixture[] | null>();
  let matched = 0;
  let unmatched = 0;
  let outOfWindow = 0;

  for (const match of pendingMatches) {
    try {
      const dateKey = match.kickoff_at.slice(0, 10);
      let dayFixtures = fixturesByDateCache.get(dateKey);
      if (dayFixtures === undefined) {
        try {
          dayFixtures = await apiFootball.getFixturesByDate(dateKey);
        } catch {
          // Le plan gratuit d'API-Football ne donne accès qu'à une fenêtre glissante de
          // quelques jours autour d'aujourd'hui : un match plus ancien tombe hors fenêtre.
          dayFixtures = null;
        }
        fixturesByDateCache.set(dateKey, dayFixtures);
        await sleep(700);
      }

      if (!dayFixtures) {
        outOfWindow++;
        continue;
      }

      const homeName = teamNameById.get(match.home_team_id) ?? "";
      const awayName = teamNameById.get(match.away_team_id) ?? "";

      const afFixture = dayFixtures.find(
        (f) =>
          apiFootballLeagueIds.has(f.league.id) &&
          teamNamesMatch(f.teams.home.name, homeName) &&
          teamNamesMatch(f.teams.away.name, awayName)
      );

      if (!afFixture) {
        unmatched++;
        continue;
      }

      const events = await apiFootball.getFixtureEvents(afFixture.fixture.id);
      await sleep(700);

      const goalRows = events
        .filter((e) => e.type === "Goal")
        .flatMap((e) => {
          const teamId = teamNamesMatch(e.team.name, homeName) ? match.home_team_id : match.away_team_id;
          const scorer = matchPlayerByName(e.player.name, playersByTeamId.get(teamId) ?? []);
          const assist = e.assist.name ? matchPlayerByName(e.assist.name, playersByTeamId.get(teamId) ?? []) : null;
          if (!scorer) return [];
          return [
            {
              match_id: match.id,
              team_id: teamId,
              player_id: scorer.id,
              assist_player_id: assist?.id ?? null,
              minute: e.time.elapsed,
            },
          ];
        });

      await supabase.from("match_goals").delete().eq("match_id", match.id);
      if (goalRows.length > 0) {
        await supabase.from("match_goals").insert(goalRows);
      }
      await supabase.from("matches").update({ events_synced_at: new Date().toISOString() }).eq("id", match.id);
      matched++;
    } catch {
      unmatched++;
    }
  }

  return { processed: pendingMatches.length, matched, unmatched, outOfWindow };
}
