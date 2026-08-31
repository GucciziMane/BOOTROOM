import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { footballData, normalizeMatchStatus } from "@/lib/football-data/client";
import { highlightly, type HlMatch } from "@/lib/highlightly/client";
import { teamNamesMatch, matchPlayerByName } from "@/lib/sync/name-match";
import { computeStandings } from "@/lib/scoring/standings";
import { computeMatchOdds } from "@/lib/scoring/match-odds";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_EVENT_CALLS_PER_RUN = 40; // reste sous le quota de 100 req/jour de Highlightly (1 call/date+championnat + 1 call/match)
// Le workflow GitHub Actions coupe la requête à 270s (curl --max-time) : on s'arrête avant, pour
// répondre à temps même si Highlightly est lent ce jour-là, plutôt que de faire échouer tout le
// run (et avec lui, sans "process scoring" en filet, la distribution des points de ce cycle).
const EVENTS_SYNC_TIME_BUDGET_MS = 200_000;

/**
 * Sync quotidien : calendrier + résultats (football-data.org), puis pour les matchs
 * fraîchement terminés, récupération des buteurs/passeurs (API-Football, par date).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  const supabase = createServiceRoleClient();
  const { data: leagues, error: leaguesError } = await supabase
    .from("leagues")
    .select("id, football_data_code, highlightly_league_id");

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
            matchday: m.matchday,
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

  const eventsSummary = await syncGoalEvents(supabase, leagues, startedAt);

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
    .select("id, home_team_id, away_team_id, status, home_score, away_score, favorite_team_id, odds_tier")
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
      // Skip la mise à jour si les cotes n'ont pas bougé : à chaque run la quasi-totalité
      // des matchs à venir sont inchangés, ça évite des centaines d'écritures inutiles.
      if (m.favorite_team_id === odds.favoriteTeamId && m.odds_tier === odds.tier) return [];
      return [{ id: m.id, favorite_team_id: odds.favoriteTeamId, odds_tier: odds.tier }];
    });

  const CONCURRENCY = 20;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map((u) =>
        supabase
          .from("matches")
          .update({ favorite_team_id: u.favorite_team_id, odds_tier: u.odds_tier })
          .eq("id", u.id)
      )
    );
  }
}

async function syncGoalEvents(
  supabase: ReturnType<typeof createServiceRoleClient>,
  leagues: Array<{ id: number; football_data_code: string; highlightly_league_id: number }>,
  startedAt: number
) {
  const highlightlyLeagueIdByLeagueId = new Map(leagues.map((l) => [l.id, l.highlightly_league_id]));

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

  const matchesByDateAndLeagueCache = new Map<string, HlMatch[] | null>();
  let matched = 0;
  let unmatched = 0;
  let outOfWindow = 0;
  let stoppedOnBudget = 0;

  for (const match of pendingMatches) {
    if (Date.now() - startedAt > EVENTS_SYNC_TIME_BUDGET_MS) {
      stoppedOnBudget = pendingMatches.length - matched - unmatched - outOfWindow;
      break;
    }
    try {
      const highlightlyLeagueId = highlightlyLeagueIdByLeagueId.get(match.league_id);
      if (!highlightlyLeagueId) {
        unmatched++;
        continue;
      }

      const dateKey = match.kickoff_at.slice(0, 10);
      const cacheKey = `${dateKey}|${highlightlyLeagueId}`;
      let dayMatches = matchesByDateAndLeagueCache.get(cacheKey);
      if (dayMatches === undefined) {
        try {
          dayMatches = await highlightly.getMatchesByDate(dateKey, highlightlyLeagueId);
        } catch {
          // Match trop ancien ou hors couverture du plan gratuit.
          dayMatches = null;
        }
        matchesByDateAndLeagueCache.set(cacheKey, dayMatches);
        await sleep(700);
      }

      if (!dayMatches) {
        outOfWindow++;
        continue;
      }

      const homeName = teamNameById.get(match.home_team_id) ?? "";
      const awayName = teamNameById.get(match.away_team_id) ?? "";

      // homeTeam/awayTeam peuvent être inversés entre football-data.org et Highlightly pour un
      // même match : on accepte les deux orientations, l'assignation but/passe par événement
      // (plus bas) ne dépend de toute façon pas de cet ordre.
      const hlMatch = dayMatches.find(
        (m) =>
          (teamNamesMatch(m.homeTeam.name, homeName) && teamNamesMatch(m.awayTeam.name, awayName)) ||
          (teamNamesMatch(m.homeTeam.name, awayName) && teamNamesMatch(m.awayTeam.name, homeName))
      );

      if (!hlMatch) {
        unmatched++;
        continue;
      }

      const events = await highlightly.getMatchEvents(hlMatch.id);
      await sleep(700);

      const goalRows = events
        .filter((e) => e.type === "Goal")
        .flatMap((e) => {
          const teamId = teamNamesMatch(e.team.name, homeName) ? match.home_team_id : match.away_team_id;
          const scorer = matchPlayerByName(e.player, playersByTeamId.get(teamId) ?? []);
          const assist = e.assist ? matchPlayerByName(e.assist, playersByTeamId.get(teamId) ?? []) : null;
          if (!scorer) return [];
          return [
            {
              match_id: match.id,
              team_id: teamId,
              player_id: scorer.id,
              assist_player_id: assist?.id ?? null,
              minute: parseInt(e.time, 10),
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

  return { processed: pendingMatches.length, matched, unmatched, outOfWindow, stoppedOnBudget };
}
