// Vérification post-migration de 0042_match_prediction_double_constraint.sql : confirme que
// league_id/matchday existent sur match_predictions, que le backfill correspond bien à matches,
// et relit les x2 actifs pour confirmer qu'aucun doublon n'a été introduit. Purement en lecture.
//
// Usage : node --env-file=.env.local scripts/verify-0042-schema.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: predictions, error: predError } = await supabase
  .from("match_predictions")
  .select("id, user_id, match_id, is_doubled, league_id, matchday");
if (predError) {
  console.error("Colonnes league_id/matchday absentes ou erreur de lecture :", predError.message);
  process.exit(1);
}
console.log(`match_predictions.league_id / .matchday existent — ${predictions.length} lignes lues.`);

const matchIds = [...new Set(predictions.map((p) => p.match_id))];
const { data: matches, error: matchError } = await supabase
  .from("matches")
  .select("id, league_id, matchday")
  .in("id", matchIds);
if (matchError) throw new Error(`Lecture matches échouée : ${matchError.message}`);
const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

let mismatches = 0;
for (const p of predictions) {
  const m = matchById.get(p.match_id);
  if (!m) continue;
  if (p.league_id !== m.league_id || p.matchday !== m.matchday) {
    mismatches++;
    console.log(
      `  DÉSYNCHRO : match_predictions.id=${p.id} match_id=${p.match_id} ` +
        `(league_id=${p.league_id}, matchday=${p.matchday}) != matches (league_id=${m.league_id}, matchday=${m.matchday})`
    );
  }
}
console.log(
  mismatches === 0
    ? "Backfill correct : league_id/matchday de match_predictions correspondent à matches sur toutes les lignes lues."
    : `${mismatches} ligne(s) désynchronisée(s) — voir détail ci-dessus.`
);

const doubled = predictions.filter((p) => p.is_doubled);
const groups = new Map();
for (const p of doubled) {
  const key = `${p.user_id}|${p.league_id}|${p.matchday}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const dup = [...groups.values()].filter((n) => n > 1).length;
console.log(`x2 actifs : ${doubled.length}. Groupes (user_id, league_id, matchday) en doublon : ${dup}.`);
