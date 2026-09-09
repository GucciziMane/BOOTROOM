// Backfill P0-1 : les 11 lignes points_ledger manquantes pour des points DÉJÀ calculés et
// stockés dans match_predictions.points_awarded, jamais propagés à points_ledger à cause d'un
// bug historique corrigé le 2026-09-08 (commit "fix: harden phase 1 data integrity") -- avant ce
// correctif, un échec de l'insert points_ledger n'empêchait ni l'écriture de
// match_predictions.points_awarded ni la pose de matches.points_processed_at.
//
// Portée strictement limitée aux 11 prédictions classées "CERTAIN" dans l'audit P0-1 (le résidu
// de points, une fois match_score recalculé avec les vraies fonctions de scoring, est
// intégralement nul -- aucune dépendance à un tier buteur/passeur disparu). Les 6 prédictions
// "PROBABLE" et les 2 "À NE PAS TOUCHER" sont explicitement exclues de ce script.
//
// Ne modifie JAMAIS matches ni match_predictions -- uniquement des insertions idempotentes dans
// points_ledger, avec le même mécanisme que process-scoring/route.ts (upsert onConflict
// user_id,source_type,source_id + ignoreDuplicates -- jamais un insert brut).
//
// DRY-RUN par défaut. Écriture réelle seulement avec --execute.
//
// Usage :
//   node --env-file=.env.local scripts/backfill-p0-1-points-ledger.mjs             (dry-run)
//   node --env-file=.env.local scripts/backfill-p0-1-points-ledger.mjs --execute   (écriture réelle)

import { createClient } from "@supabase/supabase-js";

const EXECUTE = process.argv.includes("--execute");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Manifeste figé de l'audit P0-1 (source de vérité contre laquelle l'état réel de la base est
// revérifié ci-dessous -- jamais utilisé aveuglément). recordedTotal = match_predictions.points_awarded
// déjà stocké = points à insérer dans points_ledger (source_type=match_score, la totalité du
// résidu étant nulle pour ces 11 lignes).
const MANIFEST = [
  { match_id: 1067, user_id: "1b64cb57-32f0-4010-b785-e81d57f092e7", points: 8, predicted: "3-1", actual: "5-1" },
  { match_id: 1067, user_id: "e17359ce-868a-4c8f-bc06-7dcd7ec8b9ef", points: 8, predicted: "3-1", actual: "5-1" },
  { match_id: 1067, user_id: "2fde1b12-df8e-4547-9903-7edbd9064f11", points: 8, predicted: "3-2", actual: "5-1" },
  { match_id: 1070, user_id: "2fde1b12-df8e-4547-9903-7edbd9064f11", points: 10, predicted: "2-2", actual: "3-3" },
  { match_id: 1068, user_id: "1b64cb57-32f0-4010-b785-e81d57f092e7", points: 8, predicted: "1-0", actual: "3-0" },
  { match_id: 1069, user_id: "2fde1b12-df8e-4547-9903-7edbd9064f11", points: 10, predicted: "1-1", actual: "0-0" },
  { match_id: 1076, user_id: "758fa2ce-1873-4345-9ef6-d16cbdce3a17", points: 9, predicted: "2-1", actual: "4-1" },
  { match_id: 1076, user_id: "2fde1b12-df8e-4547-9903-7edbd9064f11", points: 9, predicted: "3-1", actual: "4-1" },
  { match_id: 1078, user_id: "2fde1b12-df8e-4547-9903-7edbd9064f11", points: 9, predicted: "1-2", actual: "2-3" },
  { match_id: 1081, user_id: "1b64cb57-32f0-4010-b785-e81d57f092e7", points: 8, predicted: "0-2", actual: "0-1" },
  { match_id: 1079, user_id: "1b64cb57-32f0-4010-b785-e81d57f092e7", points: 9, predicted: "2-0", actual: "4-0" },
];

// Lignes explicitement exclues (résidu inexpliqué par les tiers actuels -- cf. rapport P0-1,
// probablement lié à la fiche joueur dupliquée de Sehrou Guirassy, problème "transferts" de la
// Phase 2.3, non retraité ici). Vérifiées ci-dessous pour garantir qu'aucune ne se glisse dans
// l'écriture, même par erreur de manifeste.
const FORBIDDEN = [
  { match_id: 1073, user_id: "2fde1b12-df8e-4547-9903-7edbd9064f11" },
  { match_id: 1078, user_id: "1b64cb57-32f0-4010-b785-e81d57f092e7" },
];

const SOURCE_TYPE = "match_score";

function abort(reason) {
  console.error(`\n❌ ABORT — ${reason}`);
  console.error("Aucune écriture effectuée.");
  process.exit(1);
}

console.log(`Mode : ${EXECUTE ? "EXECUTE (écriture réelle)" : "DRY-RUN (aucune écriture)"}`);
console.log(`${MANIFEST.length} lignes attendues, ${FORBIDDEN.length} lignes explicitement interdites.\n`);

// === Garde 1 : aucune ligne du manifeste ne doit coïncider avec une ligne interdite ===
for (const m of MANIFEST) {
  const collision = FORBIDDEN.some((f) => f.match_id === m.match_id && f.user_id === m.user_id);
  if (collision) abort(`la ligne (match_id=${m.match_id}, user_id=${m.user_id}) du manifeste est aussi dans FORBIDDEN — incohérence de manifeste, refus de continuer.`);
}

// === Garde 2 : les 8 matchs distincts existent, sont finished, points_processed_at non nul, et
// on récupère league_id (nécessaire à l'insertion, pas dans le manifeste pour ne pas le figer). ===
const matchIds = [...new Set(MANIFEST.map((m) => m.match_id))];
const { data: matches, error: matchesError } = await supabase
  .from("matches")
  .select("id, league_id, status, points_processed_at, home_score, away_score")
  .in("id", matchIds);
if (matchesError) abort(`lecture matches échouée : ${matchesError.message}`);

const matchById = new Map((matches ?? []).map((m) => [m.id, m]));
for (const id of matchIds) {
  const m = matchById.get(id);
  if (!m) abort(`match_id=${id} introuvable en base — une des 11 lignes attendues n'existe plus.`);
  if (m.status !== "finished") abort(`match_id=${id} n'est plus status='finished' (actuellement '${m.status}') — état inattendu.`);
  if (!m.points_processed_at) abort(`match_id=${id} a points_processed_at NULL — ne correspond plus à l'hypothèse du backfill (match non traité).`);
}

// === Garde 3 : les 11 prédictions existent toujours, avec exactement le points_awarded attendu. ===
const userIds = [...new Set(MANIFEST.map((m) => m.user_id))];
const { data: preds, error: predsError } = await supabase
  .from("match_predictions")
  .select("match_id, user_id, points_awarded, predicted_home_score, predicted_away_score")
  .in("match_id", matchIds)
  .in("user_id", userIds);
if (predsError) abort(`lecture match_predictions échouée : ${predsError.message}`);

const predByKey = new Map((preds ?? []).map((p) => [`${p.match_id}:${p.user_id}`, p]));
for (const m of MANIFEST) {
  const key = `${m.match_id}:${m.user_id}`;
  const p = predByKey.get(key);
  if (!p) abort(`prédiction introuvable pour (match_id=${m.match_id}, user_id=${m.user_id}) — une des 11 lignes attendues a disparu.`);
  if (p.points_awarded !== m.points) {
    abort(
      `incohérence points_awarded pour (match_id=${m.match_id}, user_id=${m.user_id}) : attendu ${m.points}, trouvé ${p.points_awarded} — les données ont changé depuis l'audit, refus de continuer sans nouvelle validation.`
    );
  }
  const actualPredicted = `${p.predicted_home_score}-${p.predicted_away_score}`;
  if (actualPredicted !== m.predicted) {
    abort(`incohérence score pronostiqué pour (match_id=${m.match_id}, user_id=${m.user_id}) : attendu ${m.predicted}, trouvé ${actualPredicted}.`);
  }
}

// === Garde 4 : vérifier l'état actuel de points_ledger pour ces 11 clés (idempotence visible). ===
const { data: existingLedger, error: ledgerReadError } = await supabase
  .from("points_ledger")
  .select("user_id, source_id, source_type, points")
  .eq("source_type", SOURCE_TYPE)
  .in("source_id", matchIds)
  .in("user_id", userIds);
if (ledgerReadError) abort(`lecture points_ledger échouée : ${ledgerReadError.message}`);

const existingByKey = new Map((existingLedger ?? []).map((l) => [`${l.source_id}:${l.user_id}`, l]));

// === Affichage DRY-RUN (toujours affiché, y compris en mode --execute, avant toute écriture) ===
console.log("Détail des 11 lignes :\n");
const toInsert = [];
for (const m of MANIFEST) {
  const key = `${m.match_id}:${m.user_id}`;
  const existing = existingByKey.get(key);
  const existingPoints = existing ? existing.points : null;
  const diff = existing ? existingPoints - m.points : m.points; // diff = ce que l'écriture ajouterait au total du user
  console.log(
    `match_id=${m.match_id} user_id=${m.user_id} source_type=${SOURCE_TYPE} source_id=${m.match_id} ` +
      `points_a_inserer=${m.points} points_awarded=${m.points} ledger_existant=${existing ? `OUI (${existingPoints} pts)` : "non"} diff=${diff}`
  );
  if (!existing) {
    toInsert.push({
      user_id: m.user_id,
      league_id: matchById.get(m.match_id).league_id,
      source_type: SOURCE_TYPE,
      source_id: m.match_id,
      points: m.points,
    });
  }
}

console.log(`\n${toInsert.length} ligne(s) réellement à insérer (${MANIFEST.length - toInsert.length} déjà présente(s) en base — script rejouable sans doublon).`);

if (!EXECUTE) {
  console.log("\nDRY-RUN terminé — aucune écriture effectuée. Relancer avec --execute pour écrire réellement.");
  process.exit(0);
}

if (toInsert.length === 0) {
  console.log("\nRien à insérer (toutes les lignes sont déjà présentes) — sortie sans écriture.");
  process.exit(0);
}

// === Écriture : un seul upsert, une seule instruction SQL atomique (toutes les lignes ou
// aucune, comme pour n'importe quel upsert multi-lignes PostgREST/Postgres) — même mécanisme
// exact que process-scoring/route.ts. ===
console.log("\nÉcriture en cours...");
const { error: insertError } = await supabase
  .from("points_ledger")
  .upsert(toInsert, { onConflict: "user_id,source_type,source_id", ignoreDuplicates: true });
if (insertError) abort(`échec de l'écriture points_ledger : ${insertError.message} — aucune ligne garantie écrite, relancer le script pour réessayer (idempotent).`);

console.log(`${toInsert.length} ligne(s) écrite(s).`);

// === Vérification post-écriture indépendante : somme points_ledger == points_awarded, pour
// CHACUNE des 11 prédictions du manifeste (pas seulement celles insérées à l'instant). ===
console.log("\nVérification post-écriture...");
const { data: finalLedger, error: finalReadError } = await supabase
  .from("points_ledger")
  .select("user_id, source_id, points")
  .eq("source_type", SOURCE_TYPE)
  .in("source_id", matchIds)
  .in("user_id", userIds);
if (finalReadError) abort(`relecture points_ledger post-écriture échouée : ${finalReadError.message}`);

const finalByKey = new Map((finalLedger ?? []).map((l) => [`${l.source_id}:${l.user_id}`, l.points]));
let allOk = true;
for (const m of MANIFEST) {
  const key = `${m.match_id}:${m.user_id}`;
  const ledgerPoints = finalByKey.get(key);
  const ok = ledgerPoints === m.points;
  if (!ok) allOk = false;
  console.log(`  match_id=${m.match_id} user_id=${m.user_id} : points_ledger=${ledgerPoints} vs points_awarded=${m.points} -> ${ok ? "OK" : "❌ MISMATCH"}`);
}

if (!allOk) abort("vérification post-écriture échouée pour au moins une ligne — voir le détail ci-dessus.");

console.log("\n✅ Vérification post-écriture : toutes les lignes concordent.");
