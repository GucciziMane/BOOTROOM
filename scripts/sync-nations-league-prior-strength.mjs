// Force historique des sélections nationales pour la Ligue des Nations, même rôle que
// updatePriorSeasonStrength (club) dans sync-teams-players : sans elle, computeMatchOdds
// (src/lib/scoring/match-odds.ts) ne peut désigner aucun favori tant qu'aucun match de la saison
// EN COURS n'est terminé (effectivePpg renvoie null faute de points/matchs joués ET de prior).
//
// Source : classement final RÉEL de la précédente édition (2024-25) de la Ligue des Nations
// côté ESPN — quatre divisions, 14 groupes, points/matchs joués par équipe. Jamais une valeur
// inventée : à défaut de ligne trouvée pour une sélection (ne devrait pas arriver, la Ligue des
// Nations réunit déjà les 54 membres UEFA), même repli que le cas club "promu sans historique" —
// supposée aussi faible que la plus faible équipe connue.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/sync-nations-league-prior-strength.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: league } = await supabase.from("leagues").select("id").eq("football_data_code", "NL").maybeSingle();
  if (!league) throw new Error('Ligue "NL" introuvable — lancer scripts/sync-nations-league.mjs d\'abord.');

  const { data: teams } = await supabase.from("teams").select("id, name, football_data_id").eq("league_id", league.id);
  console.log(`${teams.length} équipes à seeder.`);

  const res = await fetch("https://site.api.espn.com/apis/v2/sports/soccer/uefa.nations/standings?season=2024");
  if (!res.ok) throw new Error(`ESPN standings a échoué: ${res.status}`);
  const standings = await res.json();

  const ppgByEspnTeamId = new Map();
  for (const group of standings.children ?? []) {
    for (const entry of group.standings.entries) {
      const gamesPlayed = entry.stats.find((s) => s.name === "gamesPlayed")?.value ?? 0;
      const points = entry.stats.find((s) => s.name === "points")?.value ?? 0;
      if (gamesPlayed > 0) ppgByEspnTeamId.set(entry.team.id, points / gamesPlayed);
    }
  }
  console.log(`${ppgByEspnTeamId.size} équipes trouvées dans le classement 2024-25 ESPN.`);

  const knownValues = [...ppgByEspnTeamId.values()];
  const weakestDefault = knownValues.length > 0 ? Math.min(...knownValues) : null;

  const updates = teams
    .map((t) => ({ id: t.id, prior_ppg: ppgByEspnTeamId.get(String(t.football_data_id)) ?? weakestDefault, name: t.name }))
    .filter((u) => u.prior_ppg !== null);

  for (const u of updates) {
    const { error } = await supabase.from("teams").update({ prior_ppg: u.prior_ppg }).eq("id", u.id);
    if (error) console.log(`  échec ${u.name}: ${error.message}`);
  }
  const missing = teams.filter((t) => !ppgByEspnTeamId.has(String(t.football_data_id)));
  if (missing.length > 0) console.log(`Repli (plus faible connu) appliqué à: ${missing.map((t) => t.name).join(", ")}`);

  console.log(`Terminé : ${updates.length}/${teams.length} équipes seedées.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
