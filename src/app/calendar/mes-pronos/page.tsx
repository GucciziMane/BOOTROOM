import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { linkMuted } from "@/lib/ui";
import { LEAGUE_FLAG, LEAGUE_COLOR } from "@/lib/country-flags";
import { CalendarTabs } from "../CalendarTabs";

export default async function MyPredictionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: predictions } = await supabase
    .from("match_predictions")
    .select(
      "match_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id, predicted_assist_player_id, points_awarded"
    )
    .eq("user_id", user!.id);

  const matchIds = (predictions ?? []).map((p) => p.match_id);

  const [{ data: matches }, { data: goals }, { data: ledger }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, league_id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, matchday")
      .in("id", matchIds.length > 0 ? matchIds : [-1]),
    supabase.from("match_goals").select("match_id, player_id, assist_player_id").in("match_id", matchIds.length > 0 ? matchIds : [-1]),
    supabase
      .from("points_ledger")
      .select("source_id, source_type, points")
      .eq("user_id", user!.id)
      .in("source_type", ["match_score", "match_scorer", "match_assist"])
      .in("source_id", matchIds.length > 0 ? matchIds : [-1]),
  ]);

  const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

  const leagueIds = [...new Set((matches ?? []).map((m) => m.league_id))];
  const teamIds = [...new Set((matches ?? []).flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const playerIds = [
    ...new Set(
      (predictions ?? []).flatMap((p) => [p.predicted_scorer_player_id, p.predicted_assist_player_id]).filter((id): id is number => id != null)
    ),
  ];

  const [{ data: leagues }, { data: teams }, { data: players }] = await Promise.all([
    supabase.from("leagues").select("id, name, football_data_code").in("id", leagueIds.length > 0 ? leagueIds : [-1]),
    supabase.from("teams").select("id, name, logo_url").in("id", teamIds.length > 0 ? teamIds : [-1]),
    supabase.from("players").select("id, name").in("id", playerIds.length > 0 ? playerIds : [-1]),
  ]);

  const leagueById = new Map((leagues ?? []).map((l) => [l.id, l]));
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const scorersByMatch = new Map<number, Set<number>>();
  const assistersByMatch = new Map<number, Set<number>>();
  for (const g of goals ?? []) {
    if (g.player_id != null) {
      if (!scorersByMatch.has(g.match_id)) scorersByMatch.set(g.match_id, new Set());
      scorersByMatch.get(g.match_id)!.add(g.player_id);
    }
    if (g.assist_player_id != null) {
      if (!assistersByMatch.has(g.match_id)) assistersByMatch.set(g.match_id, new Set());
      assistersByMatch.get(g.match_id)!.add(g.assist_player_id);
    }
  }

  const pointsByMatchAndType = new Map<string, number>();
  for (const l of ledger ?? []) {
    pointsByMatchAndType.set(`${l.source_id}:${l.source_type}`, l.points);
  }

  const rows = (predictions ?? [])
    .map((p) => {
      const match = matchById.get(p.match_id);
      if (!match) return null;
      const league = leagueById.get(match.league_id);
      const home = teamById.get(match.home_team_id);
      const away = teamById.get(match.away_team_id);
      const isFinished = match.status === "finished" && match.home_score != null && match.away_score != null;

      const scorerName = p.predicted_scorer_player_id != null ? playerNameById.get(p.predicted_scorer_player_id) : undefined;
      const assistName = p.predicted_assist_player_id != null ? playerNameById.get(p.predicted_assist_player_id) : undefined;
      const scorerValid =
        !isFinished || p.predicted_scorer_player_id == null
          ? null
          : (scorersByMatch.get(match.id)?.has(p.predicted_scorer_player_id) ?? false);
      const assistValid =
        !isFinished || p.predicted_assist_player_id == null
          ? null
          : (assistersByMatch.get(match.id)?.has(p.predicted_assist_player_id) ?? false);

      return {
        matchId: match.id,
        kickoffAt: match.kickoff_at,
        matchday: match.matchday,
        leagueCode: league?.football_data_code ?? "",
        leagueName: league?.name ?? "",
        homeName: home?.name ?? "?",
        homeLogoUrl: home?.logo_url ?? null,
        awayName: away?.name ?? "?",
        awayLogoUrl: away?.logo_url ?? null,
        isFinished,
        predictedHome: p.predicted_home_score,
        predictedAway: p.predicted_away_score,
        realHome: match.home_score,
        realAway: match.away_score,
        scorerName,
        assistName,
        scorerValid,
        assistValid,
        scorePoints: pointsByMatchAndType.get(`${match.id}:match_score`) ?? 0,
        scorerPoints: pointsByMatchAndType.get(`${match.id}:match_scorer`) ?? 0,
        assistPoints: pointsByMatchAndType.get(`${match.id}:match_assist`) ?? 0,
        totalPoints: p.points_awarded,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));

  const totalPointsSum = rows.reduce((sum, r) => sum + (r.totalPoints ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pronostics</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <CalendarTabs active="mine" />

      <section>
        <p className="mb-4 text-sm text-mute">
          Tous tes pronostics depuis le début, du plus récent au plus ancien —{" "}
          <strong className="text-ink">{rows.length}</strong> pronostic{rows.length > 1 ? "s" : ""}, pour un total de{" "}
          <strong className="text-ink">{totalPointsSum} pts</strong>.
        </p>

        {rows.length === 0 ? (
          <p className="text-mute">Tu n&apos;as encore pronostiqué aucun match.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div
                key={r.matchId}
                className="rounded-2xl border border-line bg-paper p-4 shadow-sm"
                style={{ borderLeftColor: LEAGUE_COLOR[r.leagueCode], borderLeftWidth: 4 }}
              >
                <p className="mb-2 flex items-center justify-between text-xs font-bold text-mute">
                  <span>{formatParisDateTime(r.kickoffAt)}</span>
                  <span>
                    {LEAGUE_FLAG[r.leagueCode] ?? ""} {r.leagueName}
                    {r.matchday != null ? ` · J${r.matchday}` : ""}
                  </span>
                </p>

                <div className="flex items-center justify-center gap-4">
                  <TeamBadge name={r.homeName} logoUrl={r.homeLogoUrl} />

                  <div className="flex flex-col items-center gap-1">
                    <span className="text-lg font-bold">
                      {r.predictedHome} – {r.predictedAway}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-wide text-mute">Ton pronostic</span>
                    {r.isFinished ? (
                      <>
                        <span className="mt-1 text-lg font-bold text-ink">
                          {r.realHome} – {r.realAway}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wide text-mute">Score réel</span>
                      </>
                    ) : (
                      <span className="mt-1 text-xs font-bold text-mute">
                        {r.realHome != null && r.realAway != null ? `En cours : ${r.realHome}-${r.realAway}` : "À venir"}
                      </span>
                    )}
                  </div>

                  <TeamBadge name={r.awayName} logoUrl={r.awayLogoUrl} />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-mute">
                  {r.scorerName && (
                    <span>
                      Buteur : {r.scorerName}{" "}
                      <ValidityTag valid={r.scorerValid} points={r.scorerPoints} />
                    </span>
                  )}
                  {r.assistName && (
                    <span>
                      Passeur : {r.assistName}{" "}
                      <ValidityTag valid={r.assistValid} points={r.assistPoints} />
                    </span>
                  )}
                </div>

                <p className="mt-3 text-center text-sm font-bold">
                  {r.isFinished ? (
                    <span className={r.totalPoints ? "text-good" : "text-mute"}>
                      {r.totalPoints != null ? `+${r.totalPoints} pts` : "En attente du calcul des points"}
                    </span>
                  ) : (
                    <span className="text-mute">Match pas encore terminé</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function TeamBadge({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className="flex w-20 flex-col items-center gap-1.5 text-center">
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <span className="block h-10 w-10 shrink-0 rounded-full bg-cream" />
      )}
      <span className="text-[11px] font-bold leading-tight">{name}</span>
    </span>
  );
}

/** null = match pas encore terminé (rien à valider), true/false = pronostic buteur/passeur juste ou non. */
function ValidityTag({ valid, points }: { valid: boolean | null; points: number }) {
  if (valid === null) return <span>(en attente)</span>;
  if (valid) return <span className="font-bold text-good">✓ validé (+{points}pts)</span>;
  return <span className="font-bold text-bad">✕ non validé</span>;
}
