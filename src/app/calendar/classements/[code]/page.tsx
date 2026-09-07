import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeStandings } from "@/lib/scoring/standings";
import { formatParisDateTime } from "@/lib/format-date";
import { bannerWarn, bannerNeutral, linkMuted } from "@/lib/ui";
import { BackLink } from "@/app/BackLink";

const TOP_N = 10;

export default async function StandingsPage({ params }: PageProps<"/calendar/classements/[code]">) {
  const { code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, football_data_code, active")
    .eq("football_data_code", code)
    .maybeSingle();

  if (!league || !league.active) notFound();

  const [{ data: seasons }, { data: teamsData }] = await Promise.all([
    supabase
      .from("seasons")
      .select("id, predictions_lock_at")
      .eq("league_id", league.id)
      .order("year", { ascending: false })
      .limit(1),
    supabase.from("teams").select("id, name, logo_url").eq("league_id", league.id),
  ]);
  const season = seasons?.[0];
  const teams = teamsData ?? [];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  if (!season) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        <p className="mt-4 text-mute">Saison pas encore synchronisée.</p>
      </main>
    );
  }

  const [{ data: matches }, { data: playersData }, { data: seasonPrediction }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, home_team_id, away_team_id, home_score, away_score, status")
      .eq("season_id", season.id),
    supabase
      .from("players")
      .select("id, name, team_id")
      .in(
        "team_id",
        teams.map((t) => t.id)
      ),
    supabase
      .from("season_predictions")
      .select("top_scorer_player_id, top_assist_player_id, top3, bottom3, surprise_team_id, flop_team_id")
      .eq("user_id", user!.id)
      .eq("season_id", season.id)
      .maybeSingle(),
  ]);
  const playerById = new Map((playersData ?? []).map((p) => [p.id, p]));

  const seasonMatchIds = (matches ?? []).map((m) => m.id);

  const matchResults = (matches ?? [])
    .filter((m) => m.status === "finished" && m.home_score !== null && m.away_score !== null)
    .map((m) => ({
      homeTeamId: m.home_team_id,
      awayTeamId: m.away_team_id,
      homeScore: m.home_score as number,
      awayScore: m.away_score as number,
    }));

  const standings = computeStandings(
    matchResults,
    teams.map((t) => t.id)
  );

  const goalsByPlayer = new Map<number, number>();
  const assistsByPlayer = new Map<number, number>();
  if (seasonMatchIds.length > 0) {
    const { data: goals } = await supabase
      .from("match_goals")
      .select("player_id, assist_player_id")
      .in("match_id", seasonMatchIds);
    for (const g of goals ?? []) {
      if (g.player_id) goalsByPlayer.set(g.player_id, (goalsByPlayer.get(g.player_id) ?? 0) + 1);
      if (g.assist_player_id) assistsByPlayer.set(g.assist_player_id, (assistsByPlayer.get(g.assist_player_id) ?? 0) + 1);
    }
  }

  const rankedScorers = rankPlayers(goalsByPlayer, playerById, teamById);
  const rankedAssists = rankPlayers(assistsByPlayer, playerById, teamById);

  // Bandeau pronostics de saison : glissé ici plutôt qu'en section à part, puisque c'est
  // exactement la page où on vient déjà voir "qui est devant" — le contexte le plus naturel pour
  // rappeler qu'un pronostic reste à faire, ou pour comparer un pronostic déjà fait à la réalité.
  const locked = new Date(season.predictions_lock_at) <= new Date();
  const top3 = (seasonPrediction?.top3 as Record<string, number>) ?? {};
  const bottom3 = (seasonPrediction?.bottom3 as Record<string, number>) ?? {};
  const badgesByTeamId = new Map<number, string[]>();
  const addBadge = (teamId: number | null | undefined, badge: string) => {
    if (teamId == null) return;
    if (!badgesByTeamId.has(teamId)) badgesByTeamId.set(teamId, []);
    badgesByTeamId.get(teamId)!.push(badge);
  };
  if (seasonPrediction) {
    addBadge(top3["1"], "🎯1");
    addBadge(top3["2"], "🎯2");
    addBadge(top3["3"], "🎯3");
    addBadge(bottom3["1"], "💩1");
    addBadge(bottom3["2"], "💩2");
    addBadge(bottom3["3"], "💩3");
    addBadge(seasonPrediction.surprise_team_id, "🃏");
    addBadge(seasonPrediction.flop_team_id, "📉");
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        <BackLink href="/calendar/classements" />
      </div>

      {!locked && !seasonPrediction && (
        <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 ${bannerWarn}`}>
          <span>
            🔮 Pronostics de saison pas encore faits pour ce championnat — à envoyer avant le{" "}
            {formatParisDateTime(season.predictions_lock_at)}.
          </span>
          <Link href={`/leagues/${code}`} className="shrink-0 font-bold underline">
            Pronostiquer →
          </Link>
        </div>
      )}
      {!locked && seasonPrediction && (
        <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 ${bannerNeutral}`}>
          <span>🔮 Pronostics de saison enregistrés, modifiables jusqu&apos;au {formatParisDateTime(season.predictions_lock_at)}.</span>
          <Link href={`/leagues/${code}`} className="shrink-0 font-bold underline">
            Modifier →
          </Link>
        </div>
      )}
      {locked && seasonPrediction && (
        <p className="mb-4 text-xs text-mute">
          🎯 = ton top 3 pronostiqué · 💩 = ton flop 3 · 🃏 = ta surprise · 📉 = ton flop —{" "}
          <Link href={`/leagues/${code}`} className={linkMuted}>
            détail de tes pronostics
          </Link>
        </p>
      )}

      <section className="mb-10 overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-cream">
              <th className="p-3 text-left">#</th>
              <th className="p-3 text-left">Équipe</th>
              <th className="p-3 text-right">J</th>
              <th className="p-3 text-right">G</th>
              <th className="p-3 text-right">N</th>
              <th className="p-3 text-right">P</th>
              <th className="p-3 text-right">Diff</th>
              <th className="p-3 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const team = teamById.get(row.teamId);
              const badges = badgesByTeamId.get(row.teamId) ?? [];
              return (
                <tr key={row.teamId} className="border-b border-line last:border-0">
                  <td className="p-3 text-mute">{i + 1}</td>
                  <td className="p-3">
                    <span className="flex items-center gap-2 font-bold">
                      {team?.logo_url && (
                        <Image src={team.logo_url} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                      )}
                      {team?.name}
                      {badges.length > 0 && (
                        <span className="text-xs" title="Ton pronostic de saison">
                          {badges.join(" ")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="p-3 text-right text-mute">{row.played}</td>
                  <td className="p-3 text-right text-mute">{row.won}</td>
                  <td className="p-3 text-right text-mute">{row.drawn}</td>
                  <td className="p-3 text-right text-mute">{row.lost}</td>
                  <td className="p-3 text-right text-mute">
                    {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                  </td>
                  <td className="p-3 text-right font-bold">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <RankedPlayerList
          title="Meilleurs buteurs"
          entries={rankedScorers}
          unit="but"
          predictedPlayerId={seasonPrediction?.top_scorer_player_id ?? null}
        />
        <RankedPlayerList
          title="Meilleurs passeurs"
          entries={rankedAssists}
          unit="passe déc."
          predictedPlayerId={seasonPrediction?.top_assist_player_id ?? null}
        />
      </div>
    </main>
  );
}

interface RankedEntry {
  playerId: number;
  name: string;
  teamName: string;
  count: number;
}

function rankPlayers(
  counts: Map<number, number>,
  playerById: Map<number, { id: number; name: string; team_id: number }>,
  teamById: Map<number, { id: number; name: string; logo_url: string | null }>
): RankedEntry[] {
  return [...counts.entries()]
    .map(([playerId, count]) => {
      const player = playerById.get(playerId);
      const team = player ? teamById.get(player.team_id) : undefined;
      return { playerId, name: player?.name ?? "?", teamName: team?.name ?? "", count };
    })
    .sort((a, b) => b.count - a.count);
}

function RankedPlayerList({
  title,
  entries,
  unit,
  predictedPlayerId,
}: {
  title: string;
  entries: RankedEntry[];
  unit: string;
  predictedPlayerId: number | null;
}) {
  const visible = entries.slice(0, TOP_N);
  const predictedRank = predictedPlayerId != null ? entries.findIndex((e) => e.playerId === predictedPlayerId) : -1;
  const predictedOutsideTop = predictedRank >= TOP_N ? entries[predictedRank] : null;

  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {visible.length === 0 ? (
        <p className="text-sm text-mute">Personne pour l&apos;instant.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {visible.map((e, i) => {
            const isPrediction = e.playerId === predictedPlayerId;
            return (
              <li
                key={e.playerId}
                className={`flex items-center justify-between rounded-lg ${isPrediction ? "-mx-1.5 bg-accent-soft px-1.5 py-0.5" : ""}`}
              >
                <span>
                  <span className="mr-2 text-mute">{i + 1}.</span>
                  {isPrediction && <span className="mr-1">🔮</span>}
                  <span className="font-bold">{e.name}</span>
                  <span className="ml-1 text-mute">— {e.teamName}</span>
                </span>
                <span className="font-bold">
                  {e.count} {unit}
                  {e.count > 1 ? "s" : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {predictedOutsideTop && (
        <p className="mt-3 border-t border-line pt-2 text-xs text-mute">
          🔮 Ton pronostic : <span className="font-bold text-ink">{predictedOutsideTop.name}</span> — {predictedOutsideTop.count}{" "}
          {unit}
          {predictedOutsideTop.count > 1 ? "s" : ""} ({predictedRank + 1}e)
        </p>
      )}
    </section>
  );
}
