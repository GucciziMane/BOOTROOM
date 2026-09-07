// Backfill ponctuel de la Ligue des Champions (équipes + effectifs), lancé à la main depuis un
// terminal plutôt que via /api/cron/sync-teams-players : cette route s'est fait couper par un
// timeout de la plateforme en tentant de traiter les 6 compétitions dans la même invocation avec
// le rythme d'appels imposé par le plan gratuit football-data.org (~6.5s entre deux appels). Ce
// script ne traite que la C1, sans contrainte de durée, et laisse le cron normal reprendre la main
// pour les mises à jour suivantes (calendrier/scores via sync-fixtures, effectifs via ce même cron
// hebdomadaire qui n'aura plus qu'à retraiter une compétition déjà connue).
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FD_DELAY_MS = 7000;

async function fdFetch(path) {
  const res = await fetch(`https://api.football-data.org/v4${path}`, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function normalizePosition(pos) {
  switch (pos) {
    case "Goalkeeper":
      return "Goalkeeper";
    case "Defence":
      return "Defender";
    case "Midfield":
      return "Midfielder";
    default:
      return "Attacker";
  }
}

function computeSeasonStatus(startDate, endDate) {
  const now = Date.now();
  if (now < new Date(startDate).getTime()) return "upcoming";
  if (now > new Date(endDate).getTime()) return "finished";
  return "in_progress";
}

async function main() {
  const { data: league } = await supabase.from("leagues").select("id, football_data_code").eq("football_data_code", "CL").single();
  console.log("league:", league);

  const competition = await fdFetch(`/competitions/${league.football_data_code}`);
  const { startDate, endDate } = competition.currentSeason;
  const year = new Date(startDate).getUTCFullYear();
  console.log("season:", year, startDate, "->", endDate);

  const { data: existingSeason } = await supabase
    .from("seasons")
    .select("id")
    .eq("league_id", league.id)
    .eq("year", year)
    .maybeSingle();

  let seasonId;
  if (existingSeason) {
    seasonId = existingSeason.id;
    await supabase.from("seasons").update({ start_date: startDate, end_date: endDate, status: computeSeasonStatus(startDate, endDate) }).eq("id", seasonId);
  } else {
    const { data } = await supabase
      .from("seasons")
      .insert({ league_id: league.id, year, start_date: startDate, end_date: endDate, predictions_lock_at: startDate, status: computeSeasonStatus(startDate, endDate) })
      .select("id")
      .single();
    seasonId = data.id;
  }
  console.log("season_id:", seasonId);

  await sleep(FD_DELAY_MS);

  const { teams } = await fdFetch(`/competitions/${league.football_data_code}/teams`);
  console.log("teams fetched:", teams.length);

  const { data: upsertedTeams, error: teamsError } = await supabase
    .from("teams")
    .upsert(
      teams.map((t) => ({ league_id: league.id, name: t.name, football_data_id: t.id, logo_url: t.crest })),
      { onConflict: "league_id,football_data_id" }
    )
    .select("id, football_data_id");
  if (teamsError) throw new Error(teamsError.message);
  console.log("teams upserted:", upsertedTeams.length);

  const teamIdByFdId = new Map(upsertedTeams.map((t) => [t.football_data_id, t.id]));

  const playerRowsById = new Map();
  for (const t of teams) {
    const teamId = teamIdByFdId.get(t.id);
    if (!teamId) continue;
    for (const p of t.squad) playerRowsById.set(p.id, { ...p, team_id: teamId });
  }
  const playerRows = [...playerRowsById.values()].map((p) => ({
    team_id: p.team_id,
    name: p.name,
    position: normalizePosition(p.position),
    football_data_id: p.id,
    left_at: null,
    updated_at: new Date().toISOString(),
  }));

  const { error: playersError } = await supabase.from("players").upsert(playerRows, { onConflict: "team_id,football_data_id" });
  if (playersError) throw new Error(playersError.message);
  console.log("players upserted:", playerRows.length);

  console.log("Done — sync-fixtures cron reprendra les matchs/scores au prochain passage.");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
