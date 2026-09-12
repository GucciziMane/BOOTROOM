import { NextRequest, NextResponse } from "next/server";
import { Client as QStashClient } from "@upstash/qstash";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { footballData, normalizeMatchStatus, type FdMatch } from "@/lib/football-data/client";
import { highlightly, type HlMatch } from "@/lib/highlightly/client";
import { getEspnScoreboard, getEspnMatchEvents, ESPN_LEAGUE_SLUG } from "@/lib/espn/client";
import { teamNamesMatch, matchPlayerByName } from "@/lib/sync/name-match";
import { computeStandings } from "@/lib/scoring/standings";
import { computeMatchOdds } from "@/lib/scoring/match-odds";
import { LIVE_TICK_LOOKAHEAD_MS, LIVE_TICK_HEARTBEAT_STALE_MS } from "@/lib/live-tick-window";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_EVENT_CALLS_PER_RUN = 40; // reste sous le quota de 100 req/jour de Highlightly (1 call/date+championnat + 1 call/match)
// Le workflow GitHub Actions coupe la requête à 270s (curl --max-time) : on s'arrête avant, pour
// répondre à temps même si Highlightly est lent ce jour-là, plutôt que de faire échouer tout le
// run (et avec lui, sans "process scoring" en filet, la distribution des points de ce cycle).
const EVENTS_SYNC_TIME_BUDGET_MS = 200_000;

const APP_URL = "https://bootroom.online";
// live-tick n'a plus de schedule QStash récurrent (voir incident du 10/09/2026 — un tick fixe
// toutes les minutes, 24h/24, épuisait à lui seul le quota gratuit QStash de 1000 messages/jour en
// plein milieu d'une soirée de Ligue des Champions, arrêtant net TOUS les crons, pas seulement
// celui-ci). Ce cron (toutes les 30 min) sert désormais de réveil : LIVE_TICK_LOOKAHEAD_MS (35 min,
// partagée avec live-tick — voir live-tick-window.ts) garantit qu'aucun coup d'envoi ne peut jamais
// passer entre deux passages sans qu'une chaîne live-tick ne soit déjà réveillée ET reconnue dans
// SA PROPRE fenêtre pour la prendre en charge — les deux valeurs vivaient avant dans deux fichiers
// séparés (35 min ici, 5 min côté live-tick) et avaient dérivé l'une de l'autre (incident du
// 11/09/2026) : un réveil anticipé qui ne tombe pas dans la fenêtre de live-tick ne fait rien et ne
// relance pas la chaîne, qui meurt alors jusqu'au passage suivant, 25-30 min plus tard.
const LIVE_TICK_WAKEUP_TRAILING_MS = 150 * 60 * 1000; // même fenêtre que LIVE_WINDOW_MS côté live-tick

async function wakeLiveTickIfNeeded(supabase: ReturnType<typeof createServiceRoleClient>): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  if (!token || !cronSecret) return;

  const now = Date.now();
  const { count } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .in("status", ["scheduled", "live"])
    .gt("kickoff_at", new Date(now - LIVE_TICK_WAKEUP_TRAILING_MS).toISOString())
    .lte("kickoff_at", new Date(now + LIVE_TICK_LOOKAHEAD_MS).toISOString());
  if (!count || count === 0) return;

  // Ne réveille que si aucune chaîne d'auto-réveil ne tourne déjà (voir LIVE_TICK_HEARTBEAT_STALE_MS
  // pour l'incident que ça corrige) : sans ce garde-fou, ce réveil partait à chaque passage de ce
  // cron (30 min) tant qu'un match restait dans la fenêtre, empilant une chaîne parallèle de plus
  // à chaque fois plutôt que de laisser la chaîne déjà active se poursuivre seule.
  const { data: heartbeat } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "live_tick_last_heartbeat")
    .maybeSingle();
  if (heartbeat && now - new Date(heartbeat.value).getTime() < LIVE_TICK_HEARTBEAT_STALE_MS) return;

  try {
    const client = new QStashClient({ token });
    await client.publish({
      url: `${APP_URL}/api/cron/live-tick`,
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
  } catch {
    // Pas grave : le prochain passage de ce cron (30 min) retentera — un coup d'envoi imminent
    // reste de toute façon couvert par la marge de 35 min ci-dessus.
  }
}

/**
 * Sync quotidien : calendrier + résultats (football-data.org), puis pour les matchs
 * fraîchement terminés, récupération des buteurs/passeurs (API-Football, par date).
 */
/**
 * Score à stocker pour un match : pour un match décidé aux tirs au but, `score.fullTime` de
 * football-data.org inclut déjà les buts de la séance (fullTime = regularTime + extraTime +
 * penalties, vérifié en interrogeant l'API en direct sur des matchs C1 réels) — le score du
 * match lui-même (celui utilisé pour les pronostics score exact/résultat) est retrouvé en
 * retranchant les tirs au but, jamais en le devinant. Pour tout autre `duration`, comportement
 * strictement inchangé (score.fullTime tel quel).
 */
export function resolveMatchScore(
  score: FdMatch["score"],
  homeTeamId: number,
  awayTeamId: number
): { homeScore: number | null; awayScore: number | null; penaltyWinnerTeamId: number | null } {
  if (score.duration !== "PENALTY_SHOOTOUT") {
    return { homeScore: score.fullTime.home, awayScore: score.fullTime.away, penaltyWinnerTeamId: null };
  }

  const homePenalties = score.penalties?.home ?? 0;
  const awayPenalties = score.penalties?.away ?? 0;
  const homeScore = score.fullTime.home != null ? score.fullTime.home - homePenalties : null;
  const awayScore = score.fullTime.away != null ? score.fullTime.away - awayPenalties : null;

  // Ne jamais déduire le vainqueur aux tirs au but du score : seule une valeur explicite
  // HOME_TEAM/AWAY_TEAM de `score.winner` est retenue, sinon NULL (donnée provider incomplète ou
  // inattendue — jamais de supposition).
  let penaltyWinnerTeamId: number | null = null;
  if (score.winner === "HOME_TEAM") penaltyWinnerTeamId = homeTeamId;
  else if (score.winner === "AWAY_TEAM") penaltyWinnerTeamId = awayTeamId;

  return { homeScore, awayScore, penaltyWinnerTeamId };
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  const supabase = createServiceRoleClient();
  // .eq("active", true) : un championnat désactivé (Bundesliga, Primeira Liga) gardait ses
  // matchs/scores/événements resynchronisés à chaque passage (toutes les 30 min) comme n'importe
  // quel autre — même correctif que sync-teams-players, pour arrêter de consommer du quota
  // football-data.org/Highlightly/ESPN sur des championnats que personne ne suit cette saison.
  const { data: leagues, error: leaguesError } = await supabase
    .from("leagues")
    .select("id, football_data_code, highlightly_league_id")
    .eq("active", true);

  if (leaguesError || !leagues) {
    return NextResponse.json({ error: leaguesError?.message ?? "leagues introuvables" }, { status: 500 });
  }

  // Lu une seule fois pour tout le run (plutôt que par ligue) : sert à ne plus recalculer les
  // cotes d'un match une fois son pronostic verrouillé, voir updateMatchOdds plus bas.
  const { data: lockSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "match_prediction_lock_hours_before_kickoff")
    .maybeSingle();
  const lockHours = Number(lockSetting?.value ?? 1);

  const matchesSummary: Array<{
    league: string;
    matches: number;
    regressions?: number;
    espnRefreshed?: number;
    error?: string;
    matchdayConflicts?: string[];
  }> = [];

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

      const { data: teams } = await supabase.from("teams").select("id, name, football_data_id").eq("league_id", league.id);
      const teamIdByFdId = new Map((teams ?? []).map((t) => [t.football_data_id, t.id]));

      // Nécessaire pour détecter une régression du fournisseur (voir plus bas) : le statut/score
      // qu'on a déjà en base pour chaque match de cette ligue, avant d'appliquer les nouvelles
      // données.
      const { data: existingMatches } = await supabase
        .from("matches")
        .select("id, football_data_id, status, home_score, away_score, kickoff_at, league_id, matchday")
        .eq("league_id", league.id);
      const existingByFdId = new Map((existingMatches ?? []).map((m) => [m.football_data_id, m]));

      const { matches } = await footballData.getCompetitionMatches(league.football_data_code);

      // Une coupe à élimination directe (Ligue des Champions) n'a de "matchday" football-data.org
      // que pour sa phase de ligue — barrages/8es/1/4/1/2/finale arrivent avec matchday=null. On
      // leur assigne un numéro de journée synthétique à la suite de la phase de ligue (calculé sur
      // ce lot plutôt que codé en dur, pour rester correct si le format change) afin que "prochaine
      // journée"/le récap automatique continuent de fonctionner jusqu'à la finale — sans quoi ces
      // matchs resteraient invisibles dès la fin de la phase de ligue (cf. matches.matchday, et le
      // filtre "not is null" utilisé pour trouver la prochaine journée dans /calendar).
      const KNOCKOUT_STAGE_ORDER = ["PLAYOFFS", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL"];
      const maxRealMatchday = Math.max(0, ...matches.map((m) => m.matchday ?? 0));
      const syntheticMatchdayByStage = new Map(
        KNOCKOUT_STAGE_ORDER.map((stage, i) => [stage, maxRealMatchday + 1 + i])
      );

      let regressions = 0;
      const rows = matches.flatMap((m) => {
        const homeTeamId = teamIdByFdId.get(m.homeTeam.id);
        const awayTeamId = teamIdByFdId.get(m.awayTeam.id);
        if (!homeTeamId || !awayTeamId) return [];

        const status = normalizeMatchStatus(m.status);
        const existing = existingByFdId.get(m.id);
        // football-data.org sert parfois, pour un match précis, une réponse "en arrière" par
        // rapport à ce qu'on a déjà (ex: un match "finished" avec un score qui redevient
        // "TIMED"/sans score sur un appel suivant — confirmé en interrogeant leur API en direct,
        // pas un bug de notre synchro). Un match "finished" ne redevient donc jamais autre chose
        // ici : on ignore la ligne plutôt que d'effacer un score déjà connu et déjà noté aux
        // pronostics (points_processed_at ne serait alors plus jamais réévalué pour ce match).
        if (existing?.status === "finished" && status !== "finished") {
          regressions++;
          return [];
        }

        const { homeScore, awayScore, penaltyWinnerTeamId } = resolveMatchScore(m.score, homeTeamId, awayTeamId);

        return [
          {
            league_id: league.id,
            season_id: seasonId,
            football_data_id: m.id,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            kickoff_at: m.utcDate,
            status,
            home_score: homeScore,
            away_score: awayScore,
            penalty_winner_team_id: penaltyWinnerTeamId,
            matchday: m.matchday ?? syntheticMatchdayByStage.get(m.stage) ?? null,
            stage: m.stage,
          },
        ];
      });

      const { error: upsertError } = await supabase
        .from("matches")
        .upsert(rows, { onConflict: "football_data_id" });

      const matchdayConflicts: string[] = [];
      if (upsertError) {
        // Un match dont league_id/matchday change peut faire entrer en collision deux x2 actifs
        // du même utilisateur (contrainte match_predictions_one_double_per_matchday, migration
        // 0042) : le trigger matches_sync_prediction_matchday lève alors une exception qui fait
        // échouer TOUT le batch upsert (une seule instruction SQL multi-lignes), y compris les
        // matchs sans aucun rapport avec la collision — cf. audit Phase 2.6C.
        //
        // On ne retente en isolation QUE sur cette signature d'erreur précise (23505 sur cet
        // index précis) : toute autre erreur (réseau, contrainte différente...) continue de faire
        // échouer toute la ligue comme avant, sans tentative de contournement qui masquerait un
        // problème inattendu.
        const isMatchdayCollision =
          upsertError.code === "23505" && upsertError.message.includes("match_predictions_one_double_per_matchday");
        if (!isMatchdayCollision) throw new Error(upsertError.message);

        // Seuls les matchs dont league_id/matchday change réellement peuvent déclencher ce trigger
        // (WHEN old.league_id IS DISTINCT FROM new.league_id OR old.matchday IS DISTINCT FROM
        // new.matchday) : c'est le seul sous-ensemble à risque, jamais toute la ligue. Les autres
        // repassent en un seul batch (chemin normal, aucun changement de comportement/performance
        // pour eux).
        const changedRows = rows.filter((r) => {
          const existing = existingByFdId.get(r.football_data_id);
          return existing != null && (existing.league_id !== r.league_id || existing.matchday !== r.matchday);
        });
        const changedFdIds = new Set(changedRows.map((r) => r.football_data_id));
        const unchangedRows = rows.filter((r) => !changedFdIds.has(r.football_data_id));

        if (unchangedRows.length > 0) {
          const { error: unchangedError } = await supabase
            .from("matches")
            .upsert(unchangedRows, { onConflict: "football_data_id" });
          if (unchangedError) throw new Error(unchangedError.message);
        }

        for (const row of changedRows) {
          const { error: rowError } = await supabase.from("matches").upsert([row], { onConflict: "football_data_id" });
          if (rowError) {
            const matchId = existingByFdId.get(row.football_data_id)?.id;
            matchdayConflicts.push(
              `football_data_id=${row.football_data_id}${matchId != null ? ` (match_id=${matchId})` : ""}: ${rowError.message}`
            );
            // Pas de throw : ce match reste à son ancien league_id/matchday en base (aucune donnée
            // inventée) et sera retenté au prochain run — les autres matchs de la ligue continuent.
          }
        }
      }

      // Un vrai report (nouveau kickoff_at, ex. match postponed rejoué à une autre date) ne doit
      // pas laisser un rappel déjà loggé pour l'ancienne date bloquer silencieusement tout futur
      // rappel pour la nouvelle : reminder_log est unique par (user, kind, match_id), sans notion
      // de date. Comparaison par instant (pas par chaîne) pour ignorer les écarts de format
      // (ex. "Z" vs "+00:00") qui ne sont pas de vrais changements de date.
      const rescheduledMatchIds = matches.flatMap((m) => {
        const existing = existingByFdId.get(m.id);
        if (!existing) return [];
        const changed = new Date(existing.kickoff_at).getTime() !== new Date(m.utcDate).getTime();
        return changed ? [existing.id] : [];
      });
      if (rescheduledMatchIds.length > 0) {
        await supabase.from("reminder_log").delete().eq("kind", "match").in("source_id", rescheduledMatchIds);
      }

      await updateMatchOdds(supabase, seasonId, lockHours);

      // football-data.org gratuit annonce lui-même des scores "délayés" (pas du direct) — c'est
      // documenté sur leur propre page tarifaire, pas un bug de notre synchro. ESPN expose un
      // endpoint non-officiel, gratuit, sans clé ni limite connue, qui s'est avéré à jour sur les
      // matchs où football-data.org restait bloqué des heures. On l'utilise pour rafraîchir le
      // statut/score des matchs récents, football-data.org restant la source du calendrier/
      // effectifs (pas sensible au délai).
      const espnRefreshed = await refreshRecentScoresFromEspn(supabase, league.football_data_code, league.id, teams ?? []);

      matchesSummary.push({
        league: league.football_data_code,
        matches: rows.length,
        regressions,
        espnRefreshed,
        ...(matchdayConflicts.length > 0 ? { matchdayConflicts } : {}),
      });
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
  await wakeLiveTickIfNeeded(supabase);

  return NextResponse.json({ matches: matchesSummary, events: eventsSummary });
}

/**
 * Recalcule le favori + l'écart de niveau (odds_tier) de chaque match pas encore verrouillé de
 * la saison, à partir du classement courant (matchs terminés). Suit donc l'avancée du
 * championnat : un promu qui s'installe en haut de tableau redevient favori au fil des matchs.
 *
 * Ne touche plus un match une fois son pronostic verrouillé (kickoff_at - lockHours) : sinon le
 * multiplicateur utilisé par process-scoring pour noter ce match peut encore changer pendant
 * qu'il se joue, sous l'effet du classement mis à jour par d'autres matchs de la même journée qui
 * se terminent entretemps — pas la valeur connue du joueur au moment de son pronostic.
 */
async function updateMatchOdds(supabase: ReturnType<typeof createServiceRoleClient>, seasonId: number, lockHours: number) {
  const { data: seasonMatches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, status, home_score, away_score, favorite_team_id, odds_tier, stage, kickoff_at")
    .eq("season_id", seasonId);
  if (!seasonMatches || seasonMatches.length === 0) return;

  const teamIds = [...new Set(seasonMatches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const { data: teamsData } = await supabase.from("teams").select("id, prior_ppg").in("id", teamIds);
  const priorPpgByTeam = new Map((teamsData ?? []).map((t) => [t.id, t.prior_ppg]));

  // Un résultat à élimination directe (Ligue des Champions) fausserait un classement points/match
  // classique (aller-retour entre les deux mêmes équipes, poids disproportionné) : seule la phase
  // de ligue sert de base au calcul du favori/écart, comme pour le classement affiché (voir
  // /calendar/classements/[code]).
  const isLeaguePhase = (stage: string | null) => stage == null || stage === "REGULAR_SEASON" || stage === "LEAGUE_STAGE";

  const finishedResults = seasonMatches
    .filter((m) => m.status === "finished" && m.home_score !== null && m.away_score !== null && isLeaguePhase(m.stage))
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

  const lockCutoff = Date.now() + lockHours * 60 * 60 * 1000;
  const updates = seasonMatches
    .filter(
      (m) => (m.status === "scheduled" || m.status === "live") && new Date(m.kickoff_at).getTime() > lockCutoff
    )
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

const ESPN_REFRESH_WINDOW_DAYS = 5;

/**
 * Recale le statut/score des matchs des derniers jours sur ESPN plutôt que sur football-data.org,
 * qui les laisse parfois "en cours" ou "pas commencé" bien après la fin réelle (délai du plan
 * gratuit — voir le commentaire sur son appel plus haut). Mêmes garde-fous que pour
 * football-data.org : jamais de régression d'un match déjà "finished", et l'appariement se fait
 * par nom d'équipe (ESPN n'utilise pas nos identifiants).
 */
async function refreshRecentScoresFromEspn(
  supabase: ReturnType<typeof createServiceRoleClient>,
  footballDataCode: string,
  leagueId: number,
  leagueTeams: Array<{ id: number; name: string }>
): Promise<number> {
  const slug = ESPN_LEAGUE_SLUG[footballDataCode];
  if (!slug || leagueTeams.length === 0) return 0;

  const to = new Date();
  const from = new Date(to.getTime() - ESPN_REFRESH_WINDOW_DAYS * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

  let events;
  try {
    events = await getEspnScoreboard(slug, ymd(from), ymd(to));
  } catch {
    // Endpoint non-officiel : une panne/changement de forme ne doit jamais faire échouer le sync
    // (football-data.org reste la source de repli pour le statut/score).
    return 0;
  }
  if (events.length === 0) return 0;

  // Toutes les rencontres d'une ligue nationale se jouent entre ses propres équipes : filtrer par
  // league_id suffit, pas besoin de croiser sur les deux colonnes d'équipe.
  const { data: dbMatches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, kickoff_at, status")
    .eq("league_id", leagueId)
    .gte("kickoff_at", from.toISOString())
    .lte("kickoff_at", to.toISOString());

  let refreshed = 0;
  for (const dbMatch of dbMatches ?? []) {
    if (dbMatch.status === "finished") continue; // jamais de régression, cf. plus haut

    const homeName = leagueTeams.find((t) => t.id === dbMatch.home_team_id)?.name ?? "";
    const awayName = leagueTeams.find((t) => t.id === dbMatch.away_team_id)?.name ?? "";
    const dbDate = dbMatch.kickoff_at.slice(0, 10);

    const espnMatch = events.find(
      (e) =>
        e.date.slice(0, 10) === dbDate &&
        teamNamesMatch(e.homeTeam, homeName) &&
        teamNamesMatch(e.awayTeam, awayName)
    );
    if (!espnMatch || espnMatch.status === "scheduled") continue;
    // dbMatch.status ne peut jamais valoir "finished" ici (cf. le `continue` plus haut), donc rien
    // à mettre à jour si les deux statuts sont déjà identiques.
    if (espnMatch.status === dbMatch.status) continue;

    const { error } = await supabase
      .from("matches")
      .update({ status: espnMatch.status, home_score: espnMatch.homeScore, away_score: espnMatch.awayScore })
      .eq("id", dbMatch.id);
    if (!error) refreshed++;
  }

  return refreshed;
}

async function syncGoalEvents(
  supabase: ReturnType<typeof createServiceRoleClient>,
  leagues: Array<{ id: number; football_data_code: string; highlightly_league_id: number }>,
  startedAt: number
) {
  const highlightlyLeagueIdByLeagueId = new Map(leagues.map((l) => [l.id, l.highlightly_league_id]));
  const espnSlugByLeagueId = new Map(leagues.map((l) => [l.id, ESPN_LEAGUE_SLUG[l.football_data_code]]));

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
  const espnScoreboardCache = new Map<string, Awaited<ReturnType<typeof getEspnScoreboard>> | null>();
  let matched = 0;
  let matchedViaEspn = 0;
  let unmatched = 0;
  let outOfWindow = 0;
  let stoppedOnBudget = 0;

  const saveMatchEvents = async (
    matchId: number,
    goalRows: Array<{
      match_id: number;
      team_id: number;
      // null : joueur absent de l'effectif synchronisé (transfert récent), ou but contre son camp
      // (le buteur appartient à l'équipe qui encaisse, pas celle créditée) — voir migration 0039.
      player_id: number | null;
      assist_player_id: number | null;
      minute: number | null;
      scorer_name: string;
      assist_name: string | null;
    }>,
    subRows: Array<{ match_id: number; team_id: number; player_out_id: number | null; player_in_id: number | null; minute: number | null }> = [],
    cardRows: Array<{ match_id: number; team_id: number; player_id: number | null; card_type: "yellow" | "red"; minute: number | null }> = []
  ) => {
    await supabase.from("match_goals").delete().eq("match_id", matchId);
    if (goalRows.length > 0) {
      await supabase.from("match_goals").insert(goalRows);
    }
    await supabase.from("match_substitutions").delete().eq("match_id", matchId);
    if (subRows.length > 0) {
      await supabase.from("match_substitutions").insert(subRows);
    }
    await supabase.from("match_cards").delete().eq("match_id", matchId);
    if (cardRows.length > 0) {
      await supabase.from("match_cards").insert(cardRows);
    }
    await supabase.from("matches").update({ events_synced_at: new Date().toISOString() }).eq("id", matchId);
  };

  for (const match of pendingMatches) {
    if (Date.now() - startedAt > EVENTS_SYNC_TIME_BUDGET_MS) {
      stoppedOnBudget = pendingMatches.length - matched - unmatched - outOfWindow;
      break;
    }

    const homeName = teamNameById.get(match.home_team_id) ?? "";
    const awayName = teamNameById.get(match.away_team_id) ?? "";
    const dateKey = match.kickoff_at.slice(0, 10);

    // ESPN d'abord : pas de quota connu et une bien meilleure couverture historique que le plan
    // gratuit de Highlightly (confirmé sur des matchs qu'Highlightly ne retrouvait jamais) —
    // Highlightly reste en secours si ESPN n'a pas ce match précis ou tombe en panne.
    let matchedThisOne = false;
    const espnSlug = espnSlugByLeagueId.get(match.league_id);
    if (espnSlug) {
      try {
        const espnCacheKey = `${dateKey}|${espnSlug}`;
        let dayEvents = espnScoreboardCache.get(espnCacheKey);
        if (dayEvents === undefined) {
          try {
            const ymd = dateKey.replace(/-/g, "");
            dayEvents = await getEspnScoreboard(espnSlug, ymd, ymd);
          } catch {
            dayEvents = null;
          }
          espnScoreboardCache.set(espnCacheKey, dayEvents);
        }

        const espnMatch = (dayEvents ?? []).find(
          (e) => teamNamesMatch(e.homeTeam, homeName) && teamNamesMatch(e.awayTeam, awayName)
        );

        if (espnMatch) {
          const { goals, substitutions, cards } = await getEspnMatchEvents(espnSlug, espnMatch.id);
          const goalRows = goals.map((g) => {
            const teamId = teamNamesMatch(g.teamName, homeName) ? match.home_team_id : match.away_team_id;
            const scorer = matchPlayerByName(g.scorerName, playersByTeamId.get(teamId) ?? []);
            const assist = g.assistName ? matchPlayerByName(g.assistName, playersByTeamId.get(teamId) ?? []) : null;
            return {
              match_id: match.id,
              team_id: teamId,
              player_id: scorer?.id ?? null,
              assist_player_id: assist?.id ?? null,
              minute: g.minute,
              scorer_name: g.scorerName,
              assist_name: g.assistName,
            };
          });
          const subRows = substitutions.flatMap((s) => {
            const teamId = teamNamesMatch(s.teamName, homeName) ? match.home_team_id : match.away_team_id;
            const candidates = playersByTeamId.get(teamId) ?? [];
            const playerOut = matchPlayerByName(s.playerOutName, candidates);
            const playerIn = matchPlayerByName(s.playerInName, candidates);
            if (!playerOut && !playerIn) return [];
            return [
              {
                match_id: match.id,
                team_id: teamId,
                player_out_id: playerOut?.id ?? null,
                player_in_id: playerIn?.id ?? null,
                minute: s.minute,
              },
            ];
          });
          const cardRows = cards.flatMap((c) => {
            const teamId = teamNamesMatch(c.teamName, homeName) ? match.home_team_id : match.away_team_id;
            const player = matchPlayerByName(c.playerName, playersByTeamId.get(teamId) ?? []);
            return [
              {
                match_id: match.id,
                team_id: teamId,
                player_id: player?.id ?? null,
                card_type: c.cardType,
                minute: c.minute,
              },
            ];
          });
          await saveMatchEvents(match.id, goalRows, subRows, cardRows);
          matched++;
          matchedViaEspn++;
          matchedThisOne = true;
        }
      } catch {
        // ESPN indisponible pour ce match précis : on retombe sur Highlightly plus bas.
      }
    }
    if (matchedThisOne) continue;

    try {
      const highlightlyLeagueId = highlightlyLeagueIdByLeagueId.get(match.league_id);
      if (!highlightlyLeagueId) {
        unmatched++;
        continue;
      }

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
          if (!e.player) return [];
          const teamId = teamNamesMatch(e.team.name, homeName) ? match.home_team_id : match.away_team_id;
          const scorer = matchPlayerByName(e.player, playersByTeamId.get(teamId) ?? []);
          const assist = e.assist ? matchPlayerByName(e.assist, playersByTeamId.get(teamId) ?? []) : null;
          return [
            {
              match_id: match.id,
              team_id: teamId,
              player_id: scorer?.id ?? null,
              assist_player_id: assist?.id ?? null,
              minute: parseInt(e.time, 10),
              scorer_name: e.player,
              assist_name: e.assist ?? null,
            },
          ];
        });

      // "player" = joueur SORTANT, "substituted" = joueur ENTRANT (vérifié en croisant les
      // remplacements d'un vrai match contre les données ESPN du même match — voir HlEvent).
      const subRows = events
        .filter((e) => e.type === "Substitution")
        .flatMap((e) => {
          const teamId = teamNamesMatch(e.team.name, homeName) ? match.home_team_id : match.away_team_id;
          const candidates = playersByTeamId.get(teamId) ?? [];
          const playerOut = e.player ? matchPlayerByName(e.player, candidates) : null;
          const playerIn = e.substituted ? matchPlayerByName(e.substituted, candidates) : null;
          if (!playerOut && !playerIn) return [];
          return [
            {
              match_id: match.id,
              team_id: teamId,
              player_out_id: playerOut?.id ?? null,
              player_in_id: playerIn?.id ?? null,
              minute: parseInt(e.time, 10),
            },
          ];
        });

      const cardRows = events
        .filter((e): e is typeof e & { type: "Yellow Card" | "Red Card" } => e.type === "Yellow Card" || e.type === "Red Card")
        .flatMap((e) => {
          if (!e.player) return [];
          const teamId = teamNamesMatch(e.team.name, homeName) ? match.home_team_id : match.away_team_id;
          const player = matchPlayerByName(e.player, playersByTeamId.get(teamId) ?? []);
          return [
            {
              match_id: match.id,
              team_id: teamId,
              player_id: player?.id ?? null,
              card_type: (e.type === "Yellow Card" ? "yellow" : "red") as "yellow" | "red",
              minute: parseInt(e.time, 10),
            },
          ];
        });

      await saveMatchEvents(match.id, goalRows, subRows, cardRows);
      matched++;
    } catch {
      unmatched++;
    }
  }

  return { processed: pendingMatches.length, matched, matchedViaEspn, unmatched, outOfWindow, stoppedOnBudget };
}
