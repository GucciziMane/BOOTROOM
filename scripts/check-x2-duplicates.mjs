// Vérification préalable à la migration 0042_match_prediction_double_constraint.sql : cherche
// des doublons is_doubled = true déjà existants pour un même (user_id, league_id, matchday), que
// la nouvelle contrainte unique empêcherait de créer. Purement en lecture — ne modifie rien.
//
// Usage : node scripts/check-x2-duplicates.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: doubled, error: predError } = await supabase
  .from("match_predictions")
  .select("user_id, match_id, updated_at")
  .eq("is_doubled", true);
if (predError) throw new Error(`Lecture match_predictions échouée : ${predError.message}`);

if (!doubled || doubled.length === 0) {
  console.log("Aucun pronostic x2 actif en base — aucun doublon possible.");
  process.exit(0);
}

const matchIds = [...new Set(doubled.map((d) => d.match_id))];
const { data: matches, error: matchError } = await supabase
  .from("matches")
  .select("id, league_id, matchday")
  .in("id", matchIds);
if (matchError) throw new Error(`Lecture matches échouée : ${matchError.message}`);
const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

const groups = new Map(); // key: user_id|league_id|matchday -> rows[]
for (const row of doubled) {
  const m = matchById.get(row.match_id);
  if (!m || m.matchday == null) continue; // pas de journée assignée : pas de groupe à comparer
  const key = `${row.user_id}|${m.league_id}|${m.matchday}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ ...row, league_id: m.league_id, matchday: m.matchday });
}

const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);

console.log(`Pronostics x2 actifs au total : ${doubled.length}`);
console.log(`Groupes (user_id, league_id, matchday) avec plus d'un x2 actif : ${duplicateGroups.length}`);

if (duplicateGroups.length === 0) {
  console.log("Aucun doublon — la migration 0042 peut être appliquée directement.");
} else {
  let totalRows = 0;
  for (const [key, rows] of duplicateGroups) {
    const [userId, leagueId, matchday] = key.split("|");
    totalRows += rows.length;
    console.log(`\nuser_id=${userId}  league_id=${leagueId}  matchday=${matchday}  (${rows.length} lignes)`);
    for (const r of rows) {
      console.log(`  - match_id=${r.match_id}  updated_at=${r.updated_at}`);
    }
  }
  console.log(`\nTotal lignes match_predictions concernées : ${totalRows}`);
  console.log(
    "\nAucune correction appliquée. Pour chaque groupe ci-dessus, décider quel match_id garde\n" +
      "is_doubled = true avant d'exécuter la migration 0042."
  );
}
