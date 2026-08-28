import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { linkMuted } from "@/lib/ui";
import { computeStandings } from "@/lib/scoring/standings";

const TOP_N = 10;

export default async function StandingsPage({ params }: PageProps<"/calendar/classements/[code]">) {
  const { code } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, football_data_code, active")
    .eq("football_data_code", code)
    .maybeSingle();

  if (!league || !league.active) notFound();

  const [{ data: seasons }, { data: teamsData }] = await Promise.all([
    supabase.from("seasons").select("id").eq("league_id", league.id).order("year", { ascending: false }).limit(1),
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

  const [{ data: matches }, { data: playersData }] = await Promise.all([
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

  const topScorers = rankPlayers(goalsByPlayer, playerById, teamById);
  const topAssists = rankPlayers(assistsByPlayer, playerById, teamById);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        <Link href="/calendar/classements" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

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
              return (
                <tr key={row.teamId} className="border-b border-line last:border-0">
                  <td className="p-3 text-mute">{i + 1}</td>
                  <td className="p-3">
                    <span className="flex items-center gap-2 font-bold">
                      {team?.logo_url && <img src={team.logo_url} alt="" className="h-5 w-5 object-contain" />}
                      {team?.name}
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
        <RankedPlayerList title="Meilleurs buteurs" entries={topScorers} unit="but" />
        <RankedPlayerList title="Meilleurs passeurs" entries={topAssists} unit="passe déc." />
      </div>
    </main>
  );
}

interface RankedEntry {
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
      return { name: player?.name ?? "?", teamName: team?.name ?? "", count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N);
}

function RankedPlayerList({ title, entries, unit }: { title: string; entries: RankedEntry[]; unit: string }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-mute">Personne pour l&apos;instant.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {entries.map((e, i) => (
            <li key={`${e.name}-${i}`} className="flex items-center justify-between">
              <span>
                <span className="mr-2 text-mute">{i + 1}.</span>
                <span className="font-bold">{e.name}</span>
                <span className="ml-1 text-mute">— {e.teamName}</span>
              </span>
              <span className="font-bold">
                {e.count} {unit}
                {e.count > 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
