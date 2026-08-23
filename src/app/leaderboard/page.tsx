import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { linkMuted, listCard } from "@/lib/ui";

export default async function LeaderboardPage() {
  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, avatar_url")
    .order("username");
  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("active", true)
    .order("name");
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));
  const { data: ledgerAll } = await supabase.from("points_ledger").select("user_id, league_id, points");
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
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <ul className={`mb-8 ${listCard}`}>
        {ranked.map((p, i) => (
          <li key={p.id} className="flex items-center justify-between p-4">
            <span className="flex items-center gap-3">
              <span className="w-6 text-mute">{i + 1}</span>
              <span className="h-9 w-9 overflow-hidden rounded-full border-2 border-line bg-cream">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-sm font-bold text-mute">
                    {p.username.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="font-bold">{p.username}</span>
            </span>
            <span className="font-bold">{p.total} pts</span>
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
