import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { LEAGUE_FLAG, LEAGUE_COLOR } from "@/lib/country-flags";
import { KNOCKOUT_STAGE_LABEL } from "@/lib/knockout-stage-label";
import { FALLBACK_SCORER_TIER, FALLBACK_ASSIST_TIER, type OddsTier } from "@/lib/scoring/points";
import { computeTeamForm } from "@/lib/scoring/team-form";
import { MatchPredictionCard } from "@/app/leagues/[code]/calendar/MatchPredictionCard";
import { BackLink } from "@/app/BackLink";
import { CalendarTabs } from "./CalendarTabs";
import type { Position } from "@/types/database";

export default async function CalendarPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  //
  // seasons/teams ne filtrent plus par leagueIds côté requête (ce qui forçait à attendre le
  // résultat de la requête leagues avant de les lancer) : ce sont de petites tables (une poignée de
  // lignes par championnat, rien à voir avec les milliers de lignes de matches plus bas), donc les
  // charger en entier puis filtrer ici en mémoire coûte moins qu'un étage de requêtes séquentiel de
  // plus — chaque aller-retour réseau supplémentaire coûte cher ici (Supabase hors de la région du
  // serveur Vercel, chaque requête paye un aller-retour d'environ 300ms).
  const [
    {
      data: { session },
    },
    { data: leagues },
    { data: allSeasons },
    { data: allTeams },
  ] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("leagues").select("id, name, country, football_data_code, logo_url").eq("active", true).order("name"),
    supabase.from("seasons").select("id, league_id, year").order("year", { ascending: false }),
    supabase.from("teams").select("id, league_id, name, logo_url"),
  ]);
  const user = session?.user ?? null;

  const leagueIds = new Set((leagues ?? []).map((l) => l.id));
  const leagueById = new Map((leagues ?? []).map((l) => [l.id, l]));
  const seasonsData = (allSeasons ?? []).filter((s) => leagueIds.has(s.league_id));
  const teamsData = (allTeams ?? []).filter((t) => leagueIds.has(t.league_id));

  // Dernière saison par championnat.
  const currentSeasonByLeague = new Map<number, { id: number; year: number }>();
  for (const s of seasonsData) {
    if (!currentSeasonByLeague.has(s.league_id)) currentSeasonByLeague.set(s.league_id, { id: s.id, year: s.year });
  }
  const seasonIds = [...currentSeasonByLeague.values()].map((s) => s.id);
  const leagueIdBySeasonId = new Map([...currentSeasonByLeague.entries()].map(([leagueId, s]) => [s.id, leagueId]));

  const teamById = new Map(teamsData.map((t) => [t.id, t]));
  const teamIds = teamsData.map((t) => t.id);

  // Une seule "prochaine journée" par championnat, pas toute la saison restante : la page
  // s'appelle "Prochaine journée", et charger ~1600 matchs d'un coup la rendait lente pour
  // ne finalement afficher que les tout premiers (silencieusement tronqués par Supabase en plus).
  //
  // Un seul aller-retour par saison (au lieu de deux enchaînés : d'abord découvrir le numéro de
  // la prochaine journée, puis aller chercher ses matchs) — chaque étage supplémentaire de requêtes
  // dépendantes coûte une latence réseau entière à la page entière. Une trentaine de lignes triées
  // par (journée, coup d'envoi) suffit largement à couvrir une journée complète de n'importe quel
  // championnat, donc le filtrage "seulement la plus proche" peut se faire ici, en mémoire.
  const matchesPerSeason = await Promise.all(
    seasonIds.map(async (seasonId) => {
      const { data } = await supabase
        .from("matches")
        .select(
          "id, season_id, home_team_id, away_team_id, kickoff_at, status, favorite_team_id, odds_tier, matchday, stage, home_score, away_score, live_clock"
        )
        .eq("season_id", seasonId)
        .in("status", ["scheduled", "live"])
        .order("matchday", { ascending: true, nullsFirst: false })
        .order("kickoff_at", { ascending: true })
        .limit(30);
      const rows = data ?? [];
      const nextMatchday = rows.find((m) => m.matchday != null)?.matchday;
      return nextMatchday != null ? rows.filter((m) => m.matchday === nextMatchday) : rows.slice(0, 20);
    })
  );

  const upcoming = matchesPerSeason.flat().sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  const upcomingMatchIds = upcoming.map((m) => m.id);

  // x2 déjà actif sur la journée courante d'un championnat, y compris posé sur un match de cette
  // même journée qui vient de terminer (donc absent de `upcoming`, filtré scheduled/live plus haut
  // dans matchesPerSeason) : sans ce lot à part, le bouton x2 restait affiché à tort sur les autres
  // matchs de la journée une fois ce match-là verrouillé, jusqu'au refus côté serveur.
  const currentMatchdayBySeasonId = new Map<number, number>();
  for (const m of upcoming) {
    if (m.matchday != null && !currentMatchdayBySeasonId.has(m.season_id)) {
      currentMatchdayBySeasonId.set(m.season_id, m.matchday);
    }
  }
  const matchdaySiblingsPerSeason = await Promise.all(
    [...currentMatchdayBySeasonId.entries()].map(async ([seasonId, matchday]) => {
      const { data } = await supabase.from("matches").select("id").eq("season_id", seasonId).eq("matchday", matchday);
      return (data ?? []).map((m) => ({ matchId: m.id, seasonId, matchday }));
    })
  );
  const matchdaySiblings = matchdaySiblingsPerSeason.flat();
  const matchdaySiblingBySiblingId = new Map(matchdaySiblings.map((s) => [s.matchId, s]));

  const [
    { data: fullPredictions },
    { data: doubledPredictions },
    { data: players },
    { data: setting },
    { data: pointConfigRows },
    { data: scorerTierPointsRows },
    { data: playerTierRows },
    { data: assistTierPointsRows },
    { data: playerAssistTierRows },
    { data: resultMultiplierRows },
    { data: goalSubscriptions },
    { data: finishedMatches },
  ] = await Promise.all([
    supabase
      .from("match_predictions")
      .select(
        "match_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id, predicted_assist_player_id, is_doubled"
      )
      .eq("user_id", user!.id)
      .in("match_id", upcomingMatchIds.length > 0 ? upcomingMatchIds : [-1]),
    supabase
      .from("match_predictions")
      .select("match_id")
      .eq("user_id", user!.id)
      .eq("is_doubled", true)
      .in("match_id", matchdaySiblings.length > 0 ? matchdaySiblings.map((s) => s.matchId) : [-1]),
    supabase
      .from("players")
      .select("id, name, team_id, position")
      .in("team_id", teamIds.length > 0 ? teamIds : [-1])
      .is("left_at", null)
      .order("name"),
    supabase.from("app_settings").select("value").eq("key", "match_prediction_lock_hours_before_kickoff").single(),
    supabase.from("point_config").select("key, points").in("key", ["match_exact_score", "match_correct_result_no_score"]),
    supabase.from("match_scorer_tier_points").select("tier, points"),
    supabase.from("player_scoring_tier").select("player_id, tier").in("season_id", seasonIds.length > 0 ? seasonIds : [-1]),
    supabase.from("match_assist_tier_points").select("tier, points"),
    supabase.from("player_assist_tier").select("player_id, tier").in("season_id", seasonIds.length > 0 ? seasonIds : [-1]),
    supabase.from("match_result_tier_multipliers").select("tier, favorite_multiplier_pct, underdog_multiplier_pct, draw_multiplier_pct"),
    supabase
      .from("match_goal_subscriptions")
      .select("match_id")
      .eq("user_id", user!.id)
      .in("match_id", upcomingMatchIds.length > 0 ? upcomingMatchIds : [-1]),
    // Forme récente (3 derniers résultats) affichée sous le logo de chaque équipe : les matchs déjà
    // terminés de cette même saison suffisent, pas besoin de connaître les équipes à l'avance.
    supabase
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score, kickoff_at")
      .in("season_id", seasonIds.length > 0 ? seasonIds : [-1])
      .eq("status", "finished"),
  ]);

  const predictionByMatchId = new Map((fullPredictions ?? []).map((p) => [p.match_id, p]));
  const goalSubscribedMatchIds = new Set((goalSubscriptions ?? []).map((s) => s.match_id));
  const finishedForForm = (finishedMatches ?? [])
    .filter((m) => m.home_score != null && m.away_score != null)
    .map((m) => ({
      homeTeamId: m.home_team_id,
      awayTeamId: m.away_team_id,
      homeScore: m.home_score as number,
      awayScore: m.away_score as number,
      kickoffAt: m.kickoff_at,
    }));
  const teamFormById = new Map(teamIds.map((id) => [id, computeTeamForm(finishedForForm, id)]));
  // x2 : un seul actif par (championnat, journée) — plusieurs championnats se mélangent sur cette
  // page, donc la clé doit inclure le championnat, pas seulement le numéro de journée. Construit à
  // partir de matchdaySiblings (toute la journée, tous statuts confondus), pas seulement `upcoming`
  // (scheduled/live) : un x2 posé sur un match de cette journée qui vient de terminer doit
  // continuer à apparaître ici, sinon le bouton reste affiché à tort sur les autres matchs.
  const doubledMatchIdByGroupKey = new Map<string, number>();
  for (const p of doubledPredictions ?? []) {
    const sibling = matchdaySiblingBySiblingId.get(p.match_id);
    const leagueId = sibling ? leagueIdBySeasonId.get(sibling.seasonId) : undefined;
    if (sibling && leagueId != null) {
      doubledMatchIdByGroupKey.set(`${leagueId}:${sibling.matchday}`, p.match_id);
    }
  }
  const playersByTeamId = new Map<number, Array<{ id: number; name: string; position: Position }>>();
  for (const p of players ?? []) {
    if (!playersByTeamId.has(p.team_id)) playersByTeamId.set(p.team_id, []);
    playersByTeamId.get(p.team_id)!.push({ id: p.id, name: p.name, position: p.position });
  }
  const lockHours = Number(setting?.value ?? 1);

  const pointConfigMap = new Map((pointConfigRows ?? []).map((r) => [r.key, r.points]));
  const scorerTierPoints = new Map((scorerTierPointsRows ?? []).map((r) => [r.tier, r.points]));
  const playerTierById = new Map((playerTierRows ?? []).map((r) => [r.player_id, r.tier]));
  const assistTierPoints = new Map((assistTierPointsRows ?? []).map((r) => [r.tier, r.points]));
  const playerAssistTierById = new Map((playerAssistTierRows ?? []).map((r) => [r.player_id, r.tier]));
  const matchExactScoreBonus = pointConfigMap.get("match_exact_score") ?? 20;
  const matchCorrectResultNoScore = pointConfigMap.get("match_correct_result_no_score") ?? 50;
  const scorerTierPointsObj = Object.fromEntries(scorerTierPoints);
  const assistTierPointsObj = Object.fromEntries(assistTierPoints);
  const multiplierByTierObj = Object.fromEntries(
    (resultMultiplierRows ?? []).map((r) => [
      r.tier,
      {
        favoriteMultiplierPct: r.favorite_multiplier_pct,
        underdogMultiplierPct: r.underdog_multiplier_pct,
        drawMultiplierPct: r.draw_multiplier_pct,
      },
    ])
  );

  const groups = new Map<string, typeof upcoming>();
  for (const m of upcoming) {
    const dateKey = formatParisDateTime(m.kickoff_at).split(" à")[0];
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(m);
  }

  const teamLabel = (id: number) => {
    const t = teamById.get(id);
    return t ? { name: t.name, logoUrl: t.logo_url } : { name: "?", logoUrl: null };
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pronostics</h1>
        <BackLink href="/" />
      </div>

      <CalendarTabs active="next" />

      <section>
        <p className="mb-4 text-sm text-mute">
          La prochaine journée de chaque championnat actif, triés par date et heure : de quoi pronostiquer toute la
          journée sans changer de page.
        </p>

        {[...groups.entries()].map(([date, dayMatches]) => (
          <div key={date} className="mb-4">
            <h3 className="mb-2 text-sm font-bold text-mute">{date}</h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {dayMatches.map((m) => {
                const home = teamLabel(m.home_team_id);
                const away = teamLabel(m.away_team_id);
                const homePlayers = playersByTeamId.get(m.home_team_id) ?? [];
                const awayPlayers = playersByTeamId.get(m.away_team_id) ?? [];
                const existing = predictionByMatchId.get(m.id);
                const lockAt = new Date(new Date(m.kickoff_at).getTime() - lockHours * 3600_000);
                const locked = lockAt <= new Date();
                const leagueId = leagueIdBySeasonId.get(m.season_id);
                const league = leagueId != null ? leagueById.get(leagueId) : undefined;

                return (
                  <MatchPredictionCard
                    key={m.id}
                    leagueCode={league?.football_data_code ?? ""}
                    leagueLabel={
                      league
                        ? `${LEAGUE_FLAG[league.football_data_code] ?? ""} ${league.name}${matchdaySuffix(m.matchday, m.stage)}`
                        : undefined
                    }
                    leagueColor={league ? LEAGUE_COLOR[league.football_data_code] : undefined}
                    matchId={m.id}
                    kickoffAt={m.kickoff_at}
                    homeTeamName={home.name}
                    awayTeamName={away.name}
                    homeLogoUrl={home.logoUrl}
                    awayLogoUrl={away.logoUrl}
                    homeForm={teamFormById.get(m.home_team_id) ?? []}
                    awayForm={teamFormById.get(m.away_team_id) ?? []}
                    homePlayers={homePlayers}
                    awayPlayers={awayPlayers}
                    locked={locked}
                    initialGoalSubscribed={goalSubscribedMatchIds.has(m.id)}
                    initialIsDoubled={existing?.is_doubled ?? false}
                    doubledElsewhere={(() => {
                      if (m.matchday == null || leagueId == null) return false;
                      const key = `${leagueId}:${m.matchday}`;
                      return doubledMatchIdByGroupKey.has(key) && doubledMatchIdByGroupKey.get(key) !== m.id;
                    })()}
                    scoring={{
                      matchExactScoreBonus,
                      matchCorrectResultNoScore,
                      scorerTierPoints: scorerTierPointsObj,
                      playerTier: Object.fromEntries(
                        [...homePlayers, ...awayPlayers].map((p) => [p.id, playerTierById.get(p.id) ?? FALLBACK_SCORER_TIER])
                      ),
                      assistTierPoints: assistTierPointsObj,
                      playerAssistTier: Object.fromEntries(
                        [...homePlayers, ...awayPlayers].map((p) => [p.id, playerAssistTierById.get(p.id) ?? FALLBACK_ASSIST_TIER])
                      ),
                    }}
                    resultOdds={{
                      homeTeamId: m.home_team_id,
                      awayTeamId: m.away_team_id,
                      favoriteTeamId: m.favorite_team_id,
                      tier: m.odds_tier as OddsTier | null,
                      multiplierByTier: multiplierByTierObj,
                    }}
                    initial={{
                      predictedHomeScore: existing?.predicted_home_score ?? null,
                      predictedAwayScore: existing?.predicted_away_score ?? null,
                      predictedScorerPlayerId: existing?.predicted_scorer_player_id ?? null,
                      predictedAssistPlayerId: existing?.predicted_assist_player_id ?? null,
                    }}
                    live={
                      m.status === "live"
                        ? { homeScore: m.home_score, awayScore: m.away_score, liveClock: m.live_clock }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
        {groups.size === 0 && <p className="text-mute">Aucun match à venir.</p>}
      </section>
    </main>
  );
}

function matchdaySuffix(matchday: number | null, stage: string | null): string {
  if (matchday == null) return "";
  const stageLabel = stage ? KNOCKOUT_STAGE_LABEL[stage] : undefined;
  return ` · ${stageLabel ?? `J${matchday}`}`;
}
