import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { BackLink } from "@/app/BackLink";
import { PRIVATE_RANKING_USERNAMES } from "@/lib/leaderboard-reset";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import { fetchLeaderboardTotals } from "@/lib/leaderboard-totals";
import { LeaderboardFilter, type LeaderboardRow } from "./LeaderboardFilter";
import { MidseasonBonusCard } from "./MidseasonBonusCard";

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
    { data: predictions },
    { data: finishedMatches },
    { data: bonuses },
  ] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("profiles").select("id, username, avatar_url, favorite_team_id").order("username"),
    supabase.from("leagues").select("id, name, football_data_code").eq("active", true).order("name"),
    // Nombre de bons pronos (résultat trouvé) / scores exacts : pas de colonne dédiée dans
    // points_ledger (correctResultPoints et exactScoreBonus sont fondus dans une seule ligne
    // "match_score" depuis la refonte du barème, voir computeMatchResultPoints/computeExactScoreBonus)
    // — reconstruit ici en comparant chaque pronostic au score réel du match.
    supabase.from("match_predictions").select("user_id, match_id, league_id, predicted_home_score, predicted_away_score"),
    supabase.from("matches").select("id, home_score, away_score, kickoff_at").eq("status", "finished"),
    // Trophées mi-saison (toutes années confondues) : permanents, indépendants de la remise à
    // zéro et du classement actuel — voir MEDAL_ROW/le badge dans LeaderboardFilter.
    supabase.from("midseason_bonuses").select("id, user_id, rank, season_year, amount, kind, used_at, expires_at, target_user_id"),
  ]);
  const user = session?.user ?? null;

  const favoriteTeamIds = [...new Set((profiles ?? []).map((p) => p.favorite_team_id).filter((id): id is number => id != null))];
  const { data: favoriteTeams } = await supabase
    .from("teams")
    .select("id, logo_url")
    .in("id", favoriteTeamIds.length > 0 ? favoriteTeamIds : [-1]);
  const teamLogoById = new Map((favoriteTeams ?? []).map((t) => [t.id, t.logo_url]));
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));
  const { ledger, ledgerAllTime, totalByUser, resetAt } = await fetchLeaderboardTotals(supabase, activeLeagueIds);

  const pointsByUserByLeague = new Map<string, Map<number, number>>();
  for (const row of ledger) {
    if (!pointsByUserByLeague.has(row.user_id)) pointsByUserByLeague.set(row.user_id, new Map());
    const perLeague = pointsByUserByLeague.get(row.user_id)!;
    if (row.league_id) perLeague.set(row.league_id, (perLeague.get(row.league_id) ?? 0) + row.points);
  }

  // Bons pronos (résultat trouvé, score exact inclus) / scores exacts, par joueur ET par
  // championnat (pour le filtre) — comparé directement au score réel du match plutôt que relu
  // depuis points_ledger, qui ne distingue plus les deux depuis la refonte du barème (une seule
  // ligne "match_score" par match).
  const finishedById = new Map((finishedMatches ?? []).map((m) => [m.id, m]));
  const goodTotalByUser = new Map<string, number>();
  const exactTotalByUser = new Map<string, number>();
  const goodByUserByLeague = new Map<string, Map<number, number>>();
  const exactByUserByLeague = new Map<string, Map<number, number>>();
  for (const pred of predictions ?? []) {
    if (pred.league_id != null && !activeLeagueIds.has(pred.league_id)) continue;
    const match = finishedById.get(pred.match_id);
    if (!match || match.home_score == null || match.away_score == null) continue;
    if (resetAt && match.kickoff_at < resetAt) continue;

    const exact = pred.predicted_home_score === match.home_score && pred.predicted_away_score === match.away_score;
    const predictedDiff = Math.sign(pred.predicted_home_score - pred.predicted_away_score);
    const actualDiff = Math.sign(match.home_score - match.away_score);
    const good = exact || predictedDiff === actualDiff;

    if (good) goodTotalByUser.set(pred.user_id, (goodTotalByUser.get(pred.user_id) ?? 0) + 1);
    if (exact) exactTotalByUser.set(pred.user_id, (exactTotalByUser.get(pred.user_id) ?? 0) + 1);
    if (pred.league_id != null) {
      if (good) {
        if (!goodByUserByLeague.has(pred.user_id)) goodByUserByLeague.set(pred.user_id, new Map());
        const m = goodByUserByLeague.get(pred.user_id)!;
        m.set(pred.league_id, (m.get(pred.league_id) ?? 0) + 1);
      }
      if (exact) {
        if (!exactByUserByLeague.has(pred.user_id)) exactByUserByLeague.set(pred.user_id, new Map());
        const m = exactByUserByLeague.get(pred.user_id)!;
        m.set(pred.league_id, (m.get(pred.league_id) ?? 0) + 1);
      }
    }
  }

  const rows: LeaderboardRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    username: p.username,
    avatarUrl: p.avatar_url,
    favoriteTeamLogoUrl: p.favorite_team_id ? (teamLogoById.get(p.favorite_team_id) ?? null) : null,
    total: totalByUser.get(p.id) ?? 0,
    good: goodTotalByUser.get(p.id) ?? 0,
    exact: exactTotalByUser.get(p.id) ?? 0,
    byLeague: Object.fromEntries(
      (leagues ?? []).map((l) => [
        l.id,
        {
          points: pointsByUserByLeague.get(p.id)?.get(l.id) ?? 0,
          good: goodByUserByLeague.get(p.id)?.get(l.id) ?? 0,
          exact: exactByUserByLeague.get(p.id)?.get(l.id) ?? 0,
        },
      ])
    ),
  }));

  const privateProfiles = (profiles ?? []).filter((p) => PRIVATE_RANKING_USERNAMES.includes(p.username));
  const showPrivateRanking = privateProfiles.some((p) => p.id === user?.id);
  const privateTotalByUser = new Map<string, number>();
  for (const row of ledgerAllTime) {
    privateTotalByUser.set(row.user_id, (privateTotalByUser.get(row.user_id) ?? 0) + row.points);
  }
  const privateRanked = privateProfiles
    .map((p) => ({ ...p, total: privateTotalByUser.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  // Trophée mi-saison : uniquement pour le top 3 (kind "malus") — pas pour le bottom 3, qui n'a
  // rien à afficher fièrement. Permanent, indépendant de l'usage du bonus — un seul par joueur en
  // pratique (unique (user_id, season_year) en base), mais on garde le plus récent si jamais
  // plusieurs années s'accumulent au fil des saisons.
  const trophies = new Map<string, { rank: number; seasonYear: number }>();
  for (const b of bonuses ?? []) {
    if (b.kind !== "malus") continue;
    const existing = trophies.get(b.user_id);
    if (!existing || b.season_year > existing.seasonYear) trophies.set(b.user_id, { rank: b.rank, seasonYear: b.season_year });
  }

  // Bonus actif de l'utilisateur connecté (non utilisé, pas encore expiré) : seul cas où on lui
  // montre le sélecteur de cible sur cette page.
  const now = new Date().toISOString();
  const myBonus =
    (bonuses ?? []).find((b) => b.user_id === user?.id && !b.used_at && b.expires_at > now) ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Classement général</h1>
        <BackLink href="/" />
      </div>

      {myBonus && (
        <MidseasonBonusCard
          bonusId={myBonus.id}
          amount={myBonus.amount}
          kind={myBonus.kind}
          expiresAt={myBonus.expires_at}
          players={(profiles ?? []).filter((p) => p.id !== user?.id).map((p) => ({ id: p.id, username: p.username }))}
        />
      )}

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
        son buteur/passeur pronostiqué s&apos;est vérifié. Bons = bon résultat trouvé (score exact inclus).
      </p>

      <LeaderboardFilter
        rows={rows}
        leagues={(leagues ?? []).map((l) => ({ id: l.id, name: l.name, flag: LEAGUE_FLAG[l.football_data_code] ?? "🏆" }))}
        trophies={trophies}
      />
    </main>
  );
}
