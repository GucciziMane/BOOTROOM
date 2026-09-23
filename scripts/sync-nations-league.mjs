// Peuple/complète la Ligue des Nations (UEFA Nations League) à partir d'ESPN — seule source qui la
// couvre (football-data.org, notre source principale partout ailleurs, ne l'a pas du tout : voir
// GET /v4/competitions, absente de la liste). Contrairement aux 5 championnats existants, pas de
// endpoint "calendrier complet" côté ESPN pour cette compétition (dates=<plage> renvoie 400 dès
// qu'on dépasse un seul jour) : le calendrier est découvert jour par jour sur la fenêtre demandée.
//
// football_data_id/football_data_code/highlightly_league_id restent le nom des colonnes (schéma
// partagé avec les autres championnats) mais n'ont ici aucun rapport avec ces fournisseurs :
// football_data_id porte l'id ESPN réel (equipe/match/compétition — traçable, jamais inventé),
// highlightly_league_id un simple placeholder hors-plage (0) puisque cette ligue n'appelle jamais
// Highlightly (voir le "continue" ajouté dans sync-fixtures pour le code "NL").
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/sync-nations-league.mjs [--from=YYYYMMDD] [--to=YYYYMMDD]
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ESPN_SLUG = "uefa.nations";
const LEAGUE_ESPN_ID = 2395; // id de compétition ESPN réel (GET .../scoreboard -> leagues[0].id)
const HIGHLIGHTLY_PLACEHOLDER = 0; // jamais utilisé pour cette ligue, juste pour satisfaire NOT NULL

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const fromYmd = args.from ?? "20260901";
const toYmd = args.to ?? "20261130";

async function espnFetch(path) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer${path}`);
  if (!res.ok) throw new Error(`ESPN ${path} a échoué: ${res.status}`);
  return res.json();
}

function ymdToDate(ymd) {
  return new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`);
}

async function main() {
  console.log(`Découverte du calendrier ESPN ${ESPN_SLUG} du ${fromYmd} au ${toYmd}...`);

  // --- 1. Ligue ---
  const { data: existingLeague } = await supabase.from("leagues").select("id").eq("football_data_code", "NL").maybeSingle();
  let leagueId = existingLeague?.id;
  if (!leagueId) {
    const { data: inserted, error } = await supabase
      .from("leagues")
      .insert({
        name: "Ligue des Nations",
        country: "Europe",
        football_data_code: "NL",
        football_data_id: LEAGUE_ESPN_ID,
        highlightly_league_id: HIGHLIGHTLY_PLACEHOLDER,
        logo_url: `https://a.espncdn.com/i/leaguelogos/soccer/500/${LEAGUE_ESPN_ID}.png`,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Insertion ligue: ${error.message}`);
    leagueId = inserted.id;
    console.log(`Ligue créée: id=${leagueId}`);
  } else {
    console.log(`Ligue déjà existante: id=${leagueId}`);
  }

  // --- 2. Équipes (54 sélections nationales) ---
  const teamsResponse = await espnFetch(`/${ESPN_SLUG}/teams?limit=100`);
  const espnTeams = teamsResponse.sports[0].leagues[0].teams.map((t) => t.team);
  console.log(`${espnTeams.length} équipes trouvées côté ESPN.`);

  const { data: existingTeams } = await supabase.from("teams").select("id, football_data_id").eq("league_id", leagueId);
  const teamIdByEspnId = new Map((existingTeams ?? []).map((t) => [String(t.football_data_id), t.id]));

  const newTeamRows = espnTeams
    .filter((t) => !teamIdByEspnId.has(t.id))
    .map((t) => ({
      league_id: leagueId,
      name: t.displayName,
      football_data_id: Number(t.id),
      logo_url: t.logos?.[0]?.href ?? null,
    }));
  if (newTeamRows.length > 0) {
    const { data: insertedTeams, error } = await supabase.from("teams").insert(newTeamRows).select("id, football_data_id");
    if (error) throw new Error(`Insertion équipes: ${error.message}`);
    for (const t of insertedTeams) teamIdByEspnId.set(String(t.football_data_id), t.id);
    console.log(`${insertedTeams.length} nouvelles équipes insérées.`);
  } else {
    console.log("Toutes les équipes existent déjà.");
  }

  // --- 3. Saison ---
  const { data: existingSeason } = await supabase.from("seasons").select("id").eq("league_id", leagueId).eq("year", 2026).maybeSingle();
  let seasonId = existingSeason?.id;
  if (!seasonId) {
    const { data: insertedSeason, error } = await supabase
      .from("seasons")
      .insert({
        league_id: leagueId,
        year: 2026,
        start_date: "2026-09-24",
        predictions_lock_at: "2026-09-24T15:30:00+00:00",
        status: "in_progress",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Insertion saison: ${error.message}`);
    seasonId = insertedSeason.id;
    console.log(`Saison créée: id=${seasonId}`);
  } else {
    console.log(`Saison déjà existante: id=${seasonId}`);
  }

  // --- 4. Calendrier : découverte jour par jour (pas de plage de dates possible côté ESPN ici) ---
  const discoveredEvents = [];
  for (let d = ymdToDate(fromYmd); d <= ymdToDate(toYmd); d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
    try {
      const j = await espnFetch(`/${ESPN_SLUG}/scoreboard?dates=${ymd}`);
      for (const e of j.events ?? []) {
        const comp = e.competitions[0];
        const home = comp.competitors.find((c) => c.homeAway === "home");
        const away = comp.competitors.find((c) => c.homeAway === "away");
        discoveredEvents.push({
          espnId: Number(e.id),
          dateKey: ymd,
          kickoff: e.date,
          status: e.status?.type?.name,
          homeEspnId: home.team.id,
          awayEspnId: away.team.id,
          homeScore: home.score != null ? Number(home.score) : null,
          awayScore: away.score != null ? Number(away.score) : null,
        });
      }
    } catch {
      // Jour sans données/erreur ponctuelle : pas grave, on continue — c'est une découverte, pas
      // une synchro dont l'absence casserait quelque chose de déjà en base.
    }
  }
  console.log(`${discoveredEvents.length} matchs découverts sur la période.`);

  // Journée synthétique : les divisions A/B/C/D ne jouent pas exactement le même jour au sein
  // d'une même trêve internationale, mais se regroupent par paires de jours consécutifs (2
  // journées par trêve, comme les autres compétitions nationales). Dérivé des dates réellement
  // observées, jamais d'un calendrier officiel supposé — à corriger si jamais UEFA numérote
  // différemment, ça n'affecte que le libellé/regroupement, jamais l'exactitude des pronostics.
  const uniqueDates = [...new Set(discoveredEvents.map((e) => e.dateKey))].sort();
  const matchdayByDateKey = new Map();
  let currentMatchday = 0;
  let previousDate = null;
  for (const dateKey of uniqueDates) {
    const date = ymdToDate(dateKey);
    if (previousDate === null || (date - previousDate) / 86400000 > 2) currentMatchday++;
    matchdayByDateKey.set(dateKey, currentMatchday);
    previousDate = date;
  }

  const { data: existingMatches } = await supabase.from("matches").select("id, football_data_id").eq("league_id", leagueId);
  const matchIdByEspnId = new Map((existingMatches ?? []).map((m) => [m.football_data_id, m.id]));

  const statusMap = { STATUS_SCHEDULED: "scheduled", STATUS_FULL_TIME: "finished", STATUS_FINAL: "finished", STATUS_IN_PROGRESS: "live", STATUS_POSTPONED: "postponed", STATUS_CANCELED: "cancelled" };

  const newMatchRows = [];
  for (const e of discoveredEvents) {
    if (matchIdByEspnId.has(e.espnId)) continue;
    const homeTeamId = teamIdByEspnId.get(e.homeEspnId);
    const awayTeamId = teamIdByEspnId.get(e.awayEspnId);
    if (!homeTeamId || !awayTeamId) {
      console.log(`  ignoré (équipe inconnue) espnId=${e.espnId}`);
      continue;
    }
    newMatchRows.push({
      league_id: leagueId,
      season_id: seasonId,
      football_data_id: e.espnId,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      kickoff_at: e.kickoff,
      status: statusMap[e.status] ?? "scheduled",
      home_score: e.homeScore,
      away_score: e.awayScore,
      matchday: matchdayByDateKey.get(e.dateKey),
    });
  }

  if (newMatchRows.length > 0) {
    const { error } = await supabase.from("matches").insert(newMatchRows);
    if (error) throw new Error(`Insertion matchs: ${error.message}`);
    console.log(`${newMatchRows.length} nouveaux matchs insérés.`);
  } else {
    console.log("Aucun nouveau match à insérer (déjà tous en base).");
  }

  console.log("Terminé.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
