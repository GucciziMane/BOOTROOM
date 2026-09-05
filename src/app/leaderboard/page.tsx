import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { FavoriteTeamBadge } from "@/app/profile/FavoriteTeamBadge";
import { BackLink } from "@/app/BackLink";

export default async function LeaderboardPage() {
  const supabase = await createClient();

  const [{ data: profiles }, { data: leagues }, { data: ledgerAll }] = await Promise.all([
    supabase.from("profiles").select("id, username, avatar_url, favorite_team_id").order("username"),
    supabase.from("leagues").select("id, name").eq("active", true).order("name"),
    supabase.from("points_ledger").select("user_id, league_id, points"),
  ]);

  const favoriteTeamIds = [...new Set((profiles ?? []).map((p) => p.favorite_team_id).filter((id): id is number => id != null))];
  const { data: favoriteTeams } = await supabase
    .from("teams")
    .select("id, logo_url")
    .in("id", favoriteTeamIds.length > 0 ? favoriteTeamIds : [-1]);
  const teamLogoById = new Map((favoriteTeams ?? []).map((t) => [t.id, t.logo_url]));
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));
  const ledger = (ledgerAll ?? []).filter((row) => !row.league_id || activeLeagueIds.has(row.league_id));

  const totalByUser = new Map<string, number>();
  const byUserByLeague = new Map<string, Map<number, number>>();

  for (const row of ledger ?? []) {
    totalByUser.set(row.user_id, (totalByUser.get(row.user_id) ?? 0) + row.points);
    if (!byUserByLeague.has(row.user_id)) byUserByLeague.set(row.user_id, new Map());
    const perLeague = byUserByLeague.get(row.user_id)!;
    if (row.league_id) perLeague.set(row.league_id, (perLeague.get(row.league_id) ?? 0) + row.points);
  }

  const ranked = (profiles ?? [])
    .map((p) => ({ ...p, total: totalByUser.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Classement général</h1>
        <BackLink href="/" />
      </div>

      <p className="mb-4 text-sm text-mute">
        Clique sur un joueur pour voir tous ses pronostics passés : score prédit, score réel, points gagnés, et si
        son buteur/passeur pronostiqué s&apos;est vérifié.
      </p>

      <ul className={`mb-8 ${listCard}`}>
        {ranked.map((p, i) => (
          <li key={p.id}>
            <Link
              href={`/leaderboard/${p.id}`}
              transitionTypes={["nav-forward"]}
              className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-cream"
            >
              <span className="flex items-center gap-4">
                <span className="w-6 text-mute">{i + 1}</span>
                <span className="relative h-16 w-16 shrink-0">
                  <span className="relative block h-16 w-16 overflow-hidden rounded-full border-2 border-line bg-cream">
                    {p.avatar_url ? (
                      <Image src={p.avatar_url} alt="" fill sizes="64px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-mute">
                        {p.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <FavoriteTeamBadge logoUrl={p.favorite_team_id ? (teamLogoById.get(p.favorite_team_id) ?? null) : null} size={22} />
                </span>
                <span className="text-lg font-bold">{p.username}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-bold">{p.total} pts</span>
                <span aria-hidden className="text-mute">
                  ›
                </span>
              </span>
            </Link>
          </li>
        ))}
        {ranked.length === 0 && <li className="p-4 text-mute">Personne n&apos;a encore de points.</li>}
      </ul>

      <h2 className="mb-3 text-lg font-bold">Détail par championnat</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-cream">
              <th className="p-3 text-left">Joueur</th>
              {(leagues ?? []).map((l) => (
                <th key={l.id} className="p-3 text-right">
                  {l.name}
                </th>
              ))}
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="p-3 font-bold">{p.username}</td>
                {(leagues ?? []).map((l) => (
                  <td key={l.id} className="p-3 text-right text-mute">
                    {byUserByLeague.get(p.id)?.get(l.id) ?? 0}
                  </td>
                ))}
                <td className="p-3 text-right font-bold">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
