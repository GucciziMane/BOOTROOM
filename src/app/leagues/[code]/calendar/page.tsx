import Link from "next/link";
import Image from "next/image";
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
    .select(
      "id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, favorite_team_id, odds_tier, matchday"
    )
    .eq("season_id", season.id)
    .order("kickoff_at", { ascending: true });

  const allMatches = matches ?? [];
  // "live" à part : mélangé à "à venir", un match déjà en cours (avec un score) donnait
  // l'impression d'être encore une simple prédiction à faire plutôt qu'un match en train de se jouer.
  const live = allMatches.filter((m) => m.status === "live");
  const upcoming = allMatches.filter((m) => m.status === "scheduled");
  const recentFinished = allMatches
    .filter((m) => m.status === "finished")
    .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))
    .slice(0, 10);

  const upcomingMatchIds = [...live, ...upcoming].map((m) => m.id);

  const [
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
      .select("match_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id")
      .eq("user_id", user!.id)
      .in("match_id", upcomingMatchIds.length > 0 ? upcomingMatchIds : [-1]),
    supabase
      .from("players")
      .select("id, name, team_id")
      .in("team_id", teamIds.length > 0 ? teamIds : [-1])
      .is("left_at", null)
      .order("name"),
    supabase.from("app_settings").select("value").eq("key", "match_prediction_lock_hours_before_kickoff").single(),
    supabase.from("point_config").select("key, points").in("key", ["match_exact_score", "match_correct_result_no_score"]),
    supabase.from("match_scorer_tier_points").select("tier, points"),
    supabase.from("player_scoring_tier").select("player_id, tier").eq("season_id", season.id),
    supabase.from("match_result_tier_multipliers").select("tier, favorite_multiplier_pct, underdog_multiplier_pct"),
  ]);

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

  // Groupe d'abord par journée (numéro officiel du championnat), puis par date à l'intérieur —
  // une journée s'étale souvent sur plusieurs jours (vendredi à lundi).
  const matchdayGroups = new Map<string, { matchday: number | null; dates: Map<string, typeof upcoming> }>();
  for (const m of upcoming) {
    const matchdayKey = m.matchday != null ? String(m.matchday) : "—";
    if (!matchdayGroups.has(matchdayKey)) matchdayGroups.set(matchdayKey, { matchday: m.matchday, dates: new Map() });
    const group = matchdayGroups.get(matchdayKey)!;
    const dateKey = formatParisDateTime(m.kickoff_at).split(" à")[0];
    if (!group.dates.has(dateKey)) group.dates.set(dateKey, []);
    group.dates.get(dateKey)!.push(m);
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
              <ScoreRow key={m.id} home={teamLabel(m.home_team_id)} away={teamLabel(m.away_team_id)} homeScore={m.home_score} awayScore={m.away_score} />
            ))}
          </ul>
        </section>
      )}

      {live.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-bad" />
            </span>
            En direct
          </h2>
          <ul className={listCard}>
            {live.map((m) => (
              <ScoreRow key={m.id} home={teamLabel(m.home_team_id)} away={teamLabel(m.away_team_id)} homeScore={m.home_score} awayScore={m.away_score} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold">À venir</h2>
        {[...matchdayGroups.entries()].map(([matchdayKey, { matchday, dates }]) => (
          <div key={matchdayKey} className="mb-6">
            {matchday != null && (
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-lg font-bold">Journée {matchday}</h3>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            {[...dates.entries()].map(([date, dayMatches]) => (
              <div key={date} className="mb-4">
                <h4 className="mb-2 text-sm font-bold text-mute">{date}</h4>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              </div>
            ))}
          </div>
        ))}
        {matchdayGroups.size === 0 && <p className="text-mute">Aucun match à venir.</p>}
      </section>
    </main>
  );
}

function ScoreRow({
  home,
  away,
  homeScore,
  awayScore,
}: {
  home: { name: string; logoUrl: string | null };
  away: { name: string; logoUrl: string | null };
  homeScore: number | null;
  awayScore: number | null;
}) {
  return (
    <li className="flex items-center gap-3 p-3.5">
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5 text-right">
        <span className="truncate text-sm font-semibold">{home.name}</span>
        {home.logoUrl && <Image src={home.logoUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />}
      </div>
      <span className="shrink-0 rounded-full bg-cream px-3 py-1.5 text-sm font-extrabold tabular-nums">
        {homeScore ?? "–"} : {awayScore ?? "–"}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {away.logoUrl && <Image src={away.logoUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />}
        <span className="truncate text-sm font-semibold">{away.name}</span>
      </div>
    </li>
  );
}
