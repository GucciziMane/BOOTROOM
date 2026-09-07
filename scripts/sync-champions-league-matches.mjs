// Backfill ponctuel du calendrier Ligue des Champions (mêmes raisons que
// sync-champions-league.mjs : éviter le timeout plateforme sur /api/cron/sync-fixtures en
// traitant les 6 compétitions dans une seule invocation). sync-fixtures reprendra la main pour
// les mises à jour de scores/statuts au prochain passage normal.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fdFetch(path) {
  const res = await fetch(`https://api.football-data.org/v4${path}`, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function normalizeMatchStatus(status) {
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
    default:
      return "scheduled";
  }
}

const KNOCKOUT_STAGE_ORDER = ["PLAYOFFS", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL"];

async function main() {
  const { data: league } = await supabase.from("leagues").select("id, football_data_code").eq("football_data_code", "CL").single();
  const { data: season } = await supabase.from("seasons").select("id").eq("league_id", league.id).order("year", { ascending: false }).limit(1).single();
  console.log("league/season:", league.id, season.id);

  const { data: teams } = await supabase.from("teams").select("id, football_data_id").eq("league_id", league.id);
  const teamIdByFdId = new Map(teams.map((t) => [t.football_data_id, t.id]));
  console.log("known teams:", teams.length);

  const { matches } = await fdFetch(`/competitions/${league.football_data_code}/matches`);
  console.log("matches fetched:", matches.length);

  const maxRealMatchday = Math.max(0, ...matches.map((m) => m.matchday ?? 0));
  const syntheticMatchdayByStage = new Map(KNOCKOUT_STAGE_ORDER.map((stage, i) => [stage, maxRealMatchday + 1 + i]));
  console.log("max real matchday:", maxRealMatchday);

  const rows = matches.flatMap((m) => {
    const homeTeamId = teamIdByFdId.get(m.homeTeam.id);
    const awayTeamId = teamIdByFdId.get(m.awayTeam.id);
    if (!homeTeamId || !awayTeamId) return [];
    return [
      {
        league_id: league.id,
        season_id: season.id,
        football_data_id: m.id,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        kickoff_at: m.utcDate,
        status: normalizeMatchStatus(m.status),
        home_score: m.score.fullTime.home,
        away_score: m.score.fullTime.away,
        matchday: m.matchday ?? syntheticMatchdayByStage.get(m.stage) ?? null,
        stage: m.stage,
      },
    ];
  });
  console.log("rows to upsert (matched teams):", rows.length, "of", matches.length);

  const { error } = await supabase.from("matches").upsert(rows, { onConflict: "football_data_id" });
  if (error) throw new Error(error.message);
  console.log("Done.");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
