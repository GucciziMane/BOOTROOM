import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { linkMuted, listCard } from "@/lib/ui";
import { FALLBACK_SCORER_TIER, type OddsTier } from "@/lib/scoring/points";
import { MatchPredictionCard } from "./MatchPredictionCard";

export default async function CalendarPage({ params }: PageProps<"/leagues/[code]/calendar">) {
  const { code } = await params;
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: league },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("leagues").select("id, name, football_data_code, active").eq("football_data_code", code).maybeSingle(),
  ]);

  if (!league || !league.active) notFound();

  const [{ data: seasons }, { data: teamsData }] = await Promise.all([
    supabase.from("seasons").select("id").eq("league_id", league.id).order("year", { ascending: false }).limit(1),
    supabase.from("teams").select("id, name, logo_url").eq("league_id", league.id),
  ]);
  const season = seasons?.[0];
  const teamById = new Map((teamsData ?? []).map((t) => [t.id, t]));
  const teamIds = (teamsData ?? []).map((t) => t.id);

  if (!season) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        <p className="mt-4 text-mute">Saison pas encore synchronisée.</p>
      </main>
    );
  }

  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, favorite_team_id, odds_tier")
    .eq("season_id", season.id)
    .order("kickoff_at", { ascending: true });

  const allMatches = matches ?? [];
  const upcoming = allMatches.filter((m) => m.status === "scheduled" || m.status === "live");
  const recentFinished = allMatches
    .filter((m) => m.status === "finished")
    .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))
    .slice(0, 10);

  const matchIds = allMatches.map((m) => m.id);
  const upcomingMatchIds = upcoming.map((m) => m.id);

  const [
    { data: predictions },
    { data: fullPredictions },
    { data: players },
    { data: setting },
    { data: pointConfigRows },
    { data: scorerTierPointsRows },
    { data: playerTierRows },
    { data: resultMultiplierRows },
  ] = await Promise.all([
    supabase
      .from("match_predictions")
      .select("match_id")
      .eq("user_id", user!.id)
      .in("match_id", matchIds.length > 0 ? matchIds : [-1]),
    supabase
      .from("match_predictions")
      .select("match_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id")
      .eq("user_id", user!.id)
      .in("match_id", upcomingMatchIds.length > 0 ? upcomingMatchIds : [-1]),
    supabase.from("players").select("id, name, team_id").in("team_id", teamIds.length > 0 ? teamIds : [-1]).order("name"),
    supabase.from("app_settings").select("value").eq("key", "match_prediction_lock_hours_before_kickoff").single(),
    supabase.from("point_config").select("key, points").in("key", ["match_exact_score", "match_correct_result_no_score"]),
    supabase.from("match_scorer_tier_points").select("tier, points"),
    supabase.from("player_scoring_tier").select("player_id, tier").eq("season_id", season.id),
    supabase.from("match_result_tier_multipliers").select("tier, favorite_multiplier_pct, underdog_multiplier_pct"),
  ]);

  const predictedMatchIds = new Set((predictions ?? []).map((p) => p.match_id));
  const predictionByMatchId = new Map((fullPredictions ?? []).map((p) => [p.match_id, p]));
  const playersByTeamId = new Map<number, Array<{ id: number; name: string }>>();
  for (const p of players ?? []) {
    if (!playersByTeamId.has(p.team_id)) playersByTeamId.set(p.team_id, []);
    playersByTeamId.get(p.team_id)!.push({ id: p.id, name: p.name });
  }
  const lockHours = Number(setting?.value ?? 1);

  const pointConfigMap = new Map((pointConfigRows ?? []).map((r) => [r.key, r.points]));
  const scorerTierPoints = new Map((scorerTierPointsRows ?? []).map((r) => [r.tier, r.points]));
  const playerTierById = new Map((playerTierRows ?? []).map((r) => [r.player_id, r.tier]));
  const matchExactScore = pointConfigMap.get("match_exact_score") ?? 30;
  const scorerTierPointsObj = Object.fromEntries(scorerTierPoints);
  const multiplierByTierObj = Object.fromEntries(
    (resultMultiplierRows ?? []).map((r) => [
      r.tier,
      { favoriteMultiplierPct: r.favorite_multiplier_pct, underdogMultiplierPct: r.underdog_multiplier_pct },
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
        <h1 className="text-3xl font-bold">{league.name} — Calendrier</h1>
        <Link href="/calendar" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      {recentFinished.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Derniers résultats</h2>
          <ul className={listCard}>
            {recentFinished.map((m) => (
              <li key={m.id} className="flex items-center justify-between p-3 text-sm">
                <MatchTeams home={teamLabel(m.home_team_id)} away={teamLabel(m.away_team_id)} />
                <span className="font-bold">
                  {m.home_score} – {m.away_score}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold">À venir</h2>
        {[...groups.entries()].map(([date, dayMatches]) => (
          <div key={date} className="mb-4">
            <h3 className="mb-2 text-sm font-bold text-mute">{date}</h3>

            {/* Desktop : pronostic (score + buteur) directement dans la liste. */}
            <div className="hidden gap-3 lg:grid lg:grid-cols-2">
              {dayMatches.map((m) => {
                const home = teamLabel(m.home_team_id);
                const away = teamLabel(m.away_team_id);
                const homePlayers = playersByTeamId.get(m.home_team_id) ?? [];
                const awayPlayers = playersByTeamId.get(m.away_team_id) ?? [];
                const existing = predictionByMatchId.get(m.id);
                const lockAt = new Date(new Date(m.kickoff_at).getTime() - lockHours * 3600_000);
                const locked = lockAt <= new Date();

                return (
                  <MatchPredictionCard
                    key={m.id}
                    leagueCode={code}
                    matchId={m.id}
                    kickoffAt={m.kickoff_at}
                    homeTeamName={home.name}
                    awayTeamName={away.name}
                    homeLogoUrl={home.logoUrl}
                    awayLogoUrl={away.logoUrl}
                    homePlayers={homePlayers}
                    awayPlayers={awayPlayers}
                    locked={locked}
                    scoring={{
                      matchExactScore,
                      scorerTierPoints: scorerTierPointsObj,
                      playerTier: Object.fromEntries(
                        [...homePlayers, ...awayPlayers].map((p) => [p.id, playerTierById.get(p.id) ?? FALLBACK_SCORER_TIER])
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
                    }}
                  />
                );
              })}
            </div>

            {/* Mobile : liste compacte vers la page dédiée à chaque match. */}
            <ul className={`${listCard} lg:hidden`}>
              {dayMatches.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/leagues/${code}/calendar/${m.id}`}
                    className="flex items-center justify-between p-3 text-sm transition-colors hover:bg-cream"
                  >
                    <MatchTeams home={teamLabel(m.home_team_id)} away={teamLabel(m.away_team_id)} />
                    <span className="font-bold">
                      {predictedMatchIds.has(m.id) ? (
                        <span className="text-good">Pronostiqué</span>
                      ) : (
                        <span className="text-ink underline decoration-2 underline-offset-2">Pronostiquer</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groups.size === 0 && <p className="text-mute">Aucun match à venir.</p>}
      </section>
    </main>
  );
}

function MatchTeams({
  home,
  away,
}: {
  home: { name: string; logoUrl: string | null };
  away: { name: string; logoUrl: string | null };
}) {
  return (
    <span className="flex items-center gap-2">
      {home.logoUrl && <img src={home.logoUrl} alt="" className="h-5 w-5 object-contain" />}
      <span>{home.name}</span>
      <span className="text-mute">vs</span>
      {away.logoUrl && <img src={away.logoUrl} alt="" className="h-5 w-5 object-contain" />}
      <span>{away.name}</span>
    </span>
  );
}
