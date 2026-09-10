import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { FavoriteTeamBadge } from "@/app/profile/FavoriteTeamBadge";
import { BackLink } from "@/app/BackLink";
import { LEADERBOARD_RESET_KEY, PRIVATE_RANKING_USERNAMES } from "@/lib/leaderboard-reset";
import { LEAGUE_FLAG } from "@/lib/country-flags";

export default async function LeaderboardPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const [
    {
      data: { session },
    },
    { data: profiles },
    { data: leagues },
    { data: ledgerAll },
    { data: resetSetting },
    { data: predictions },
    { data: finishedMatches },
  ] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("profiles").select("id, username, avatar_url, favorite_team_id").order("username"),
    supabase.from("leagues").select("id, name, football_data_code").eq("active", true).order("name"),
    supabase.from("points_ledger").select("user_id, league_id, points, created_at"),
    supabase.from("app_settings").select("value").eq("key", LEADERBOARD_RESET_KEY).maybeSingle(),
    // Nombre de bons pronos (résultat trouvé) / scores exacts : pas de colonne dédiée dans
    // points_ledger (correctResultPoints et exactScoreBonus sont fondus dans une seule ligne
    // "match_score" depuis la refonte du barème, voir computeMatchResultPoints/computeExactScoreBonus)
    // — reconstruit ici en comparant chaque pronostic au score réel du match.
    supabase.from("match_predictions").select("user_id, match_id, league_id, predicted_home_score, predicted_away_score"),
    supabase.from("matches").select("id, home_score, away_score, kickoff_at").eq("status", "finished"),
  ]);
  const user = session?.user ?? null;

  const favoriteTeamIds = [...new Set((profiles ?? []).map((p) => p.favorite_team_id).filter((id): id is number => id != null))];
  const { data: favoriteTeams } = await supabase
    .from("teams")
    .select("id, logo_url")
    .in("id", favoriteTeamIds.length > 0 ? favoriteTeamIds : [-1]);
  const teamLogoById = new Map((favoriteTeams ?? []).map((t) => [t.id, t.logo_url]));
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));
  // Ledger complet (avant/après remise à zéro), scopé aux ligues actives comme avant — seule base
  // commune aux deux classements ci-dessous.
  const ledgerAllTime = (ledgerAll ?? []).filter((row) => !row.league_id || activeLeagueIds.has(row.league_id));
  const resetAt = resetSetting?.value ?? null;
  const ledger = resetAt ? ledgerAllTime.filter((row) => row.created_at >= resetAt) : ledgerAllTime;

  const totalByUser = new Map<string, number>();
  const byUserByLeague = new Map<string, Map<number, number>>();

  for (const row of ledger) {
    totalByUser.set(row.user_id, (totalByUser.get(row.user_id) ?? 0) + row.points);
    if (!byUserByLeague.has(row.user_id)) byUserByLeague.set(row.user_id, new Map());
    const perLeague = byUserByLeague.get(row.user_id)!;
    if (row.league_id) perLeague.set(row.league_id, (perLeague.get(row.league_id) ?? 0) + row.points);
  }

  // Bons pronos (résultat trouvé, score exact inclus) / scores exacts, scopés aux ligues actives et
  // à la même coupure de remise à zéro que les points ci-dessus — comparé directement au score réel
  // du match plutôt que relu depuis points_ledger, qui ne distingue plus les deux depuis la refonte
  // du barème (une seule ligne "match_score" par match).
  const finishedById = new Map((finishedMatches ?? []).map((m) => [m.id, m]));
  const goodPredictionsByUser = new Map<string, number>();
  const exactScoresByUser = new Map<string, number>();
  for (const pred of predictions ?? []) {
    if (pred.league_id != null && !activeLeagueIds.has(pred.league_id)) continue;
    const match = finishedById.get(pred.match_id);
    if (!match || match.home_score == null || match.away_score == null) continue;
    if (resetAt && match.kickoff_at < resetAt) continue;

    const exact = pred.predicted_home_score === match.home_score && pred.predicted_away_score === match.away_score;
    const predictedDiff = Math.sign(pred.predicted_home_score - pred.predicted_away_score);
    const actualDiff = Math.sign(match.home_score - match.away_score);
    if (exact || predictedDiff === actualDiff) {
      goodPredictionsByUser.set(pred.user_id, (goodPredictionsByUser.get(pred.user_id) ?? 0) + 1);
    }
    if (exact) {
      exactScoresByUser.set(pred.user_id, (exactScoresByUser.get(pred.user_id) ?? 0) + 1);
    }
  }

  const ranked = (profiles ?? [])
    .map((p) => ({ ...p, total: totalByUser.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const privateProfiles = (profiles ?? []).filter((p) => PRIVATE_RANKING_USERNAMES.includes(p.username));
  const showPrivateRanking = privateProfiles.some((p) => p.id === user?.id);
  const privateTotalByUser = new Map<string, number>();
  for (const row of ledgerAllTime) {
    privateTotalByUser.set(row.user_id, (privateTotalByUser.get(row.user_id) ?? 0) + row.points);
  }
  const privateRanked = privateProfiles
    .map((p) => ({ ...p, total: privateTotalByUser.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Classement général</h1>
        <BackLink href="/" />
      </div>

      {showPrivateRanking && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold text-reward">Entre nous 🔒</h2>
          <ul className={`${listCard} border-reward`}>
            {privateRanked.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                <span className="flex items-center gap-4">
                  <span className="w-6 text-mute">{i + 1}</span>
                  <span className="text-lg font-bold">{p.username}</span>
                </span>
                <span className="font-bold text-reward">{p.total} pts</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
              // Toute la liste est visible sans scroll (petit groupe d'amis) : sans ça, le profil de
              // chaque joueur précharge en arrière-plan dès l'affichage de cette page.
              prefetch={false}
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
      {/* table-fixed + colonnes en % (via colgroup) plutôt que overflow-x-auto : avec les noms
          complets des championnats en en-tête, la table dépassait la largeur de l'écran sur
          mobile et obligeait à scroller horizontalement — les drapeaux (déjà utilisés ailleurs,
          voir /leagues) tiennent sur une seule colonne étroite, toute la page reste visible sans
          scroll latéral. */}
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full table-fixed text-xs sm:text-sm">
          <colgroup>
            <col style={{ width: "30%" }} />
            {(leagues ?? []).map((l) => (
              <col key={l.id} style={{ width: `${(leagues?.length ?? 0) > 0 ? 54 / (leagues?.length ?? 1) : 0}%` }} />
            ))}
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-line bg-cream">
              <th className="p-1.5 text-left sm:p-3">Joueur</th>
              {(leagues ?? []).map((l) => (
                <th key={l.id} className="p-1.5 text-right sm:p-3" title={l.name}>
                  {LEAGUE_FLAG[l.football_data_code] ?? l.name.slice(0, 3)}
                </th>
              ))}
              <th className="p-1.5 text-right sm:p-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="truncate p-1.5 font-bold sm:p-3">{p.username}</td>
                {(leagues ?? []).map((l) => (
                  <td key={l.id} className="p-1.5 text-right text-mute sm:p-3">
                    {byUserByLeague.get(p.id)?.get(l.id) ?? 0}
                  </td>
                ))}
                <td className="p-1.5 text-right font-bold sm:p-3">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold">Précision des pronostics</h2>
      <p className="mb-3 text-sm text-mute">
        Bons pronos = bon résultat trouvé (score exact inclus) — championnats actifs uniquement.
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full table-fixed text-xs sm:text-sm">
          <colgroup>
            <col style={{ width: "46%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "27%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-line bg-cream">
              <th className="p-1.5 text-left sm:p-3">Joueur</th>
              <th className="p-1.5 text-right sm:p-3">Bons pronos</th>
              <th className="p-1.5 text-right sm:p-3">Score exact</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="truncate p-1.5 font-bold sm:p-3">{p.username}</td>
                <td className="p-1.5 text-right text-mute sm:p-3">{goodPredictionsByUser.get(p.id) ?? 0}</td>
                <td className="p-1.5 text-right text-mute sm:p-3">{exactScoresByUser.get(p.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
