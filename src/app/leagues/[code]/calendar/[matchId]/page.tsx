import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { bannerWarn, bannerNeutral, card, linkMuted } from "@/lib/ui";
import { FALLBACK_SCORER_TIER } from "@/lib/scoring/points";
import { MatchPredictionForm } from "./MatchPredictionForm";

export default async function MatchPage({ params }: PageProps<"/leagues/[code]/calendar/[matchId]">) {
  const { code, matchId } = await params;
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: match },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("matches")
      .select(
        "id, season_id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, favorite_team_id, odds_tier"
      )
      .eq("id", Number(matchId))
      .maybeSingle(),
  ]);

  if (!match) notFound();

  const [
    { data: teams },
    { data: players },
    { data: setting },
    { data: existing },
    { data: pointConfigRows },
    { data: scorerTierPointsRows },
    { data: playerTierRows },
    { data: resultMultiplierRows },
  ] = await Promise.all([
    supabase.from("teams").select("id, name").in("id", [match.home_team_id, match.away_team_id]),
    supabase
      .from("players")
      .select("id, name, team_id")
      .in("team_id", [match.home_team_id, match.away_team_id])
      .order("name"),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "match_prediction_lock_hours_before_kickoff")
      .single(),
    supabase
      .from("match_predictions")
      .select("predicted_home_score, predicted_away_score, predicted_scorer_player_id")
      .eq("user_id", user!.id)
      .eq("match_id", match.id)
      .maybeSingle(),
    supabase
      .from("point_config")
      .select("key, points")
      .in("key", ["match_exact_score", "match_correct_result_no_score"]),
    supabase.from("match_scorer_tier_points").select("tier, points"),
    supabase.from("player_scoring_tier").select("player_id, tier").eq("season_id", match.season_id),
    supabase.from("match_result_tier_multipliers").select("tier, favorite_multiplier_pct, underdog_multiplier_pct"),
  ]);
  const homeTeam = teams?.find((t) => t.id === match.home_team_id);
  const awayTeam = teams?.find((t) => t.id === match.away_team_id);
  const homePlayers = (players ?? []).filter((p) => p.team_id === match.home_team_id);
  const awayPlayers = (players ?? []).filter((p) => p.team_id === match.away_team_id);
  const lockHours = Number(setting?.value ?? 1);
  const lockAt = new Date(new Date(match.kickoff_at).getTime() - lockHours * 3600_000);
  const locked = lockAt <= new Date();

  const pointConfigMap = new Map((pointConfigRows ?? []).map((r) => [r.key, r.points]));
  const scorerTierPoints = new Map((scorerTierPointsRows ?? []).map((r) => [r.tier, r.points]));
  const playerTierById = new Map((playerTierRows ?? []).map((r) => [r.player_id, r.tier]));
  const scoring = {
    matchExactScore: pointConfigMap.get("match_exact_score") ?? 30,
    matchCorrectResultNoScore: pointConfigMap.get("match_correct_result_no_score") ?? 10,
    scorerTierPoints: Object.fromEntries(scorerTierPoints),
    playerTier: Object.fromEntries(
      [...homePlayers, ...awayPlayers].map((p) => [p.id, playerTierById.get(p.id) ?? FALLBACK_SCORER_TIER])
    ),
  };
  const resultOdds = {
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    favoriteTeamId: match.favorite_team_id,
    favoriteTeamName:
      match.favorite_team_id === match.home_team_id
        ? (homeTeam?.name ?? null)
        : match.favorite_team_id === match.away_team_id
          ? (awayTeam?.name ?? null)
          : null,
    tier: match.odds_tier,
    multiplierByTier: Object.fromEntries(
      (resultMultiplierRows ?? []).map((r) => [
        r.tier,
        { favoriteMultiplierPct: r.favorite_multiplier_pct, underdogMultiplierPct: r.underdog_multiplier_pct },
      ])
    ),
  };

  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {homeTeam?.name} vs {awayTeam?.name}
        </h1>
        <Link href={`/leagues/${code}/calendar`} className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <p className="mb-6 text-sm text-mute">Coup d&apos;envoi : {formatParisDateTime(match.kickoff_at)}</p>

      {match.status === "finished" && (
        <div className={`mb-6 text-center ${bannerNeutral}`}>
          <span className="text-2xl font-bold text-ink">
            {match.home_score} – {match.away_score}
          </span>
        </div>
      )}

      <div className={`mb-6 ${locked ? bannerNeutral : bannerWarn}`}>
        {locked
          ? `Verrouillé depuis le ${formatParisDateTime(lockAt.toISOString())}.`
          : `Modifiable jusqu'au ${formatParisDateTime(lockAt.toISOString())}.`}
      </div>

      {locked ? (
        <div className={card}>
          <LockedMatchSummary existing={existing ?? null} homePlayers={homePlayers} awayPlayers={awayPlayers} />
        </div>
      ) : (
        <MatchPredictionForm
          leagueCode={code}
          matchId={match.id}
          homeTeamName={homeTeam?.name ?? "?"}
          awayTeamName={awayTeam?.name ?? "?"}
          homePlayers={homePlayers}
          awayPlayers={awayPlayers}
          scoring={scoring}
          resultOdds={resultOdds}
          initial={{
            predictedHomeScore: existing?.predicted_home_score ?? null,
            predictedAwayScore: existing?.predicted_away_score ?? null,
            predictedScorerPlayerId: existing?.predicted_scorer_player_id ?? null,
          }}
        />
      )}
    </main>
  );
}

function LockedMatchSummary({
  existing,
  homePlayers,
  awayPlayers,
}: {
  existing: {
    predicted_home_score: number;
    predicted_away_score: number;
    predicted_scorer_player_id: number | null;
  } | null;
  homePlayers: Array<{ id: number; name: string }>;
  awayPlayers: Array<{ id: number; name: string }>;
}) {
  if (!existing) {
    return <p className="text-mute">Tu n&apos;as pas pronostiqué ce match avant le verrouillage.</p>;
  }
  const scorer = [...homePlayers, ...awayPlayers].find((p) => p.id === existing.predicted_scorer_player_id);

  return (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-mute">Ton pronostic</dt>
        <dd className="text-2xl font-bold">
          {existing.predicted_home_score} – {existing.predicted_away_score}
        </dd>
      </div>
      <div>
        <dt className="text-mute">Buteur pronostiqué</dt>
        <dd className="text-lg font-bold">{scorer?.name ?? "—"}</dd>
      </div>
    </dl>
  );
}
