import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { linkMuted, listCard } from "@/lib/ui";

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
    .select("id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score")
    .eq("season_id", season.id)
    .order("kickoff_at", { ascending: true });

  const allMatches = matches ?? [];
  const upcoming = allMatches.filter((m) => m.status === "scheduled" || m.status === "live");
  const recentFinished = allMatches
    .filter((m) => m.status === "finished")
    .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))
    .slice(0, 10);

  const matchIds = allMatches.map((m) => m.id);
  const { data: predictions } = await supabase
    .from("match_predictions")
    .select("match_id")
    .eq("user_id", user!.id)
    .in("match_id", matchIds.length > 0 ? matchIds : [-1]);
  const predictedMatchIds = new Set((predictions ?? []).map((p) => p.match_id));

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
            <ul className={listCard}>
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
