import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { footballData, normalizePosition } from "@/lib/football-data/client";

// Sans ce plafond explicite, une invocation s'est fait couper (constaté en préparant l'arrivée de
// la Ligue des Champions) avant la fin des ~13 appels espacés de FOOTBALL_DATA_RATE_LIMIT_DELAY_MS
// nécessaires pour 6 compétitions — la limite par défaut de la plateforme était donc plus basse que
// prévu pour cette route. 300s laisse de la marge même si d'autres compétitions s'ajoutent.
export const maxDuration = 300;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Plan gratuit football-data.org : 10 requêtes/minute. Ce cron fait jusqu'à 3 appels par
// championnat (compétition, équipes+effectifs, classement saison précédente) — avec 700ms entre
// deux appels, 6 championnats (5 domestiques + Ligue des Champions) tenaient sous ~13s, largement
// au-dessus de 10 req/min et provoquant des 429 en fin de boucle (constaté à l'ajout de la 6e
// compétition, jamais atteint avant avec seulement 5). ~6.5s entre deux appels reste sous la
// limite avec marge, quel que soit le nombre de compétitions suivies.
const FOOTBALL_DATA_RATE_LIMIT_DELAY_MS = 6_500;

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

// Un lot de 2 tient large sous le plafond de durée de la plateforme même dans le pire cas (3
// appels/compétition à FOOTBALL_DATA_RATE_LIMIT_DELAY_MS d'écart). Avec le cron quotidien
// (vercel.json), 6 compétitions tournent complètement tous les 3 jours — largement suffisant pour
// des effectifs qui ne bougent qu'au mercato.
const BATCH_SIZE = 2;

/**
 * Sync : équipes + effectifs + saison en cours. Ne traite qu'un petit lot de compétitions par
 * invocation (les moins récemment resynchronisées d'abord), jamais toutes à la fois — voir
 * BATCH_SIZE. Source unique : football-data.org (pas de restriction de saison, 2-3 appels/compétition).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  // .eq("active", true) : un championnat désactivé (Bundesliga, Primeira Liga — pas suivi cette
  // saison) gardait ses effectifs synchronisés à chaque passage comme n'importe quel autre,
  // consommant pour rien le quota football-data.org (déjà serré, voir FOOTBALL_DATA_RATE_LIMIT_DELAY_MS)
  // sur des données que personne n'utilise. live-tick excluait déjà ces championnats de son suivi
  // minute par minute ; celui-ci (et sync-fixtures, même correctif) ne le faisait pas.
  const { data: leagues, error: leaguesError } = await supabase
    .from("leagues")
    .select("id, football_data_code")
    .eq("active", true)
    .order("roster_synced_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (leaguesError || !leagues) {
    return NextResponse.json({ error: leaguesError?.message ?? "leagues introuvables" }, { status: 500 });
  }

  const summary: Array<{ league: string; teams: number; players: number; error?: string }> = [];

  for (const league of leagues) {
    try {
      const competition = await footballData.getCompetition(league.football_data_code);
      const { startDate, endDate } = competition.currentSeason;
      const year = new Date(startDate).getUTCFullYear();

      // Logo du championnat (affiché à côté de son nom un peu partout) : jamais fourni par les
      // autres endpoints football-data.org utilisés ici (équipes, matchs), seulement celui-ci.
      if (competition.emblem) {
        await supabase.from("leagues").update({ logo_url: competition.emblem }).eq("id", league.id);
      }

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

      await sleep(FOOTBALL_DATA_RATE_LIMIT_DELAY_MS);

      const { teams } = await footballData.getCompetitionTeams(league.football_data_code);

      // onConflict sur (league_id, football_data_id) et non football_data_id seul : football-data.org
      // attribue le même id à un club dans toutes les compétitions où il joue (ex: le Real Madrid a
      // le même id en Liga et en Ligue des Champions) — un conflit sur football_data_id seul ferait
      // basculer le league_id d'un club déjà suivi ailleurs vers cette compétition-ci.
      const { data: upsertedTeams, error: teamsError } = await supabase
        .from("teams")
        .upsert(
          teams.map((t) => ({ league_id: league.id, name: t.name, football_data_id: t.id, logo_url: t.crest })),
          { onConflict: "league_id,football_data_id" }
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
        // Repasse actif un joueur qui reviendrait dans l'effectif (retour de prêt...) après avoir
        // été marqué "parti" par un sync précédent.
        left_at: null,
        updated_at: new Date().toISOString(),
      }));

      // Même raisonnement que pour teams ci-dessus : un joueur transféré entre deux clubs suivis
      // garde le même football_data_id, donc onConflict doit être scopé par team_id.
      const { error: playersError } = await supabase
        .from("players")
        .upsert(playerRows, { onConflict: "team_id,football_data_id" });

      if (playersError) {
        throw new Error(playersError.message);
      }

      // Marque "parti" (sans supprimer : des buts/pronostics passés référencent peut-être ce
      // joueur) toute personne qui était dans cet effectif et ne s'y trouve plus dans la réponse
      // actuelle — le mercato ne se reflétait jamais côté départs avant ce correctif.
      const teamIds = [...new Set(playerRows.map((p) => p.team_id))];
      const syncedFdIds = playerRows.map((p) => p.football_data_id);
      if (teamIds.length > 0) {
        await supabase
          .from("players")
          .update({ left_at: new Date().toISOString() })
          .in("team_id", teamIds)
          .is("left_at", null)
          .not("football_data_id", "in", `(${syncedFdIds.join(",") || "-1"})`);
      }

      await sleep(FOOTBALL_DATA_RATE_LIMIT_DELAY_MS);
      await updatePriorSeasonStrength(supabase, league.football_data_code, year, teamIdByFdId);

      summary.push({ league: league.football_data_code, teams: upsertedTeams.length, players: playerRows.length });
      await sleep(FOOTBALL_DATA_RATE_LIMIT_DELAY_MS);
    } catch (err) {
      summary.push({
        league: league.football_data_code,
        teams: 0,
        players: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      // Sans cette pause, un 429 sur une compétition enchaînait en rafale (sans délai) sur toutes
      // les suivantes de la boucle — chacune retombant en 429 à son tour avant que la fenêtre ait
      // eu la moindre chance de se libérer. La pause s'appliquait déjà sur le chemin de succès,
      // pas ici.
      await sleep(FOOTBALL_DATA_RATE_LIMIT_DELAY_MS);
    }

    // Y compris après un échec : sans ça, une compétition qui échoue systématiquement (clé
    // manquante côté source, etc.) resterait pour toujours en tête de la file "moins récemment
    // resynchronisée" et monopoliserait le lot à chaque run, empêchant les autres de tourner.
    await supabase.from("leagues").update({ roster_synced_at: new Date().toISOString() }).eq("id", league.id);
  }

  return NextResponse.json({ summary });
}
