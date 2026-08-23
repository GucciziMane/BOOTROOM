import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { footballData, normalizePosition } from "@/lib/football-data/client";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Force historique (points/match de la saison précédente) de chaque équipe, utilisée pour
 * désigner un favori dès le premier match de la saison en cours (voir lib/scoring/match-odds).
 * Ne réinterroge l'API que si au moins une équipe n'a pas encore de prior enregistré : le
 * classement d'une saison terminée ne change plus, inutile de le refetch à chaque sync hebdo.
 */
async function updatePriorSeasonStrength(
  supabase: ServiceClient,
  code: string,
  currentYear: number,
  teamIdByFdId: Map<number, number>
) {
  const teamIds = [...teamIdByFdId.values()];
  const { data: existing } = await supabase.from("teams").select("id, prior_ppg").in("id", teamIds);
  const alreadyHasPrior = new Set((existing ?? []).filter((t) => t.prior_ppg !== null).map((t) => t.id));
  if (teamIds.every((id) => alreadyHasPrior.has(id))) return;

  let table: Array<{ team: { id: number }; playedGames: number; points: number }>;
  try {
    const standings = await footballData.getStandings(code, currentYear - 1);
    table = standings.standings.find((s) => s.type === "TOTAL")?.table ?? [];
  } catch {
    // Saison précédente indisponible (compétition tout juste suivie, etc.) : pas de prior pour l'instant.
    return;
  }
  if (table.length === 0) return;

  const priorPpgByFdTeamId = new Map(table.map((row) => [row.team.id, row.points / row.playedGames]));
  const knownPpgValues = [...priorPpgByFdTeamId.values()];
  // Équipe promue sans historique dans cette division : on la suppose aussi faible que la
  // lanterne rouge de la saison passée, faute de mieux.
  const promotedDefaultPpg = knownPpgValues.length > 0 ? Math.min(...knownPpgValues) : null;

  const updates = [...teamIdByFdId.entries()]
    .map(([fdTeamId, teamId]) => ({ id: teamId, prior_ppg: priorPpgByFdTeamId.get(fdTeamId) ?? promotedDefaultPpg }))
    .filter((u) => u.prior_ppg !== null);

  for (const u of updates) {
    await supabase.from("teams").update({ prior_ppg: u.prior_ppg }).eq("id", u.id);
  }
}

function computeSeasonStatus(startDate: string, endDate: string): "upcoming" | "in_progress" | "finished" {
  const now = Date.now();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (now < start) return "upcoming";
  if (now > end) return "finished";
  return "in_progress";
}

/**
 * Sync hebdomadaire : équipes + effectifs + saison en cours, pour les 5 championnats.
 * Source unique : football-data.org (pas de restriction de saison, tout en 2 appels/ligue).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const { data: leagues, error: leaguesError } = await supabase
    .from("leagues")
    .select("id, football_data_code");

  if (leaguesError || !leagues) {
    return NextResponse.json({ error: leaguesError?.message ?? "leagues introuvables" }, { status: 500 });
  }

  const summary: Array<{ league: string; teams: number; players: number; error?: string }> = [];

  for (const league of leagues) {
    try {
      const competition = await footballData.getCompetition(league.football_data_code);
      const { startDate, endDate } = competition.currentSeason;
      const year = new Date(startDate).getUTCFullYear();

      const { data: existingSeason } = await supabase
        .from("seasons")
        .select("id, predictions_lock_at")
        .eq("league_id", league.id)
        .eq("year", year)
        .maybeSingle();

      if (existingSeason) {
        await supabase
          .from("seasons")
          .update({ start_date: startDate, end_date: endDate, status: computeSeasonStatus(startDate, endDate) })
          .eq("id", existingSeason.id);
      } else {
        await supabase.from("seasons").insert({
          league_id: league.id,
          year,
          start_date: startDate,
          end_date: endDate,
          predictions_lock_at: startDate,
          status: computeSeasonStatus(startDate, endDate),
        });
      }

      await sleep(700);

      const { teams } = await footballData.getCompetitionTeams(league.football_data_code);

      const { data: upsertedTeams, error: teamsError } = await supabase
        .from("teams")
        .upsert(
          teams.map((t) => ({ league_id: league.id, name: t.name, football_data_id: t.id, logo_url: t.crest })),
          { onConflict: "football_data_id" }
        )
        .select("id, football_data_id");

      if (teamsError || !upsertedTeams) {
        throw new Error(teamsError?.message ?? "échec upsert teams");
      }

      const teamIdByFdId = new Map(upsertedTeams.map((t) => [t.football_data_id, t.id]));

      const playerRowsById = new Map<number, (typeof teams)[number]["squad"][number] & { team_id: number }>();
      for (const t of teams) {
        const teamId = teamIdByFdId.get(t.id);
        if (!teamId) continue;
        // football-data.org liste parfois un joueur dans 2 effectifs lors d'un transfert en
        // cours de synchro : on ne garde que la dernière occurrence rencontrée.
        for (const p of t.squad) {
          playerRowsById.set(p.id, { ...p, team_id: teamId });
        }
      }

      const playerRows = [...playerRowsById.values()].map((p) => ({
        team_id: p.team_id,
        name: p.name,
        position: normalizePosition(p.position),
        football_data_id: p.id,
        updated_at: new Date().toISOString(),
      }));

      const { error: playersError } = await supabase
        .from("players")
        .upsert(playerRows, { onConflict: "football_data_id" });

      if (playersError) {
        throw new Error(playersError.message);
      }

      await sleep(700);
      await updatePriorSeasonStrength(supabase, league.football_data_code, year, teamIdByFdId);

      summary.push({ league: league.football_data_code, teams: upsertedTeams.length, players: playerRows.length });
      await sleep(700);
    } catch (err) {
      summary.push({
        league: league.football_data_code,
        teams: 0,
        players: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ summary });
}
