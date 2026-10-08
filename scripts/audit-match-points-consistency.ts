// Audit en lecture seule, indépendant des réglages de scoring actuels (contrairement à
// audit-match-points.ts qui recalcule avec la config d'AUJOURD'HUI — faussé dès qu'un multiplicateur
// de cote ou un point_config a été retouché depuis le traitement d'un match, ce qui est un
// changement de réglage volontaire, pas une erreur de paiement).
//
// Ici on vérifie uniquement la COHÉRENCE INTERNE, qui elle ne doit jamais dépendre de la config :
//  - somme des lignes points_ledger (match_score+match_scorer+match_assist) pour (match,user)
//    == match_predictions.points_awarded pour ce même (match,user)
//  - pas de ligne ledger orpheline (source_id renvoyant vers un pronostic introuvable)
//  - pas de doublon ledger sur la même clé (user,source_type,source_id) — la contrainte unique
//    l'empêche déjà en théorie, vérifié quand même
//  - pas de points_awarded négatif ou de ligne ledger négative sur ces source_type
//  - tout match "finished" a bien points_processed_at renseigné (aucun oublié)
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/audit-match-points-consistency.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import type { PointsSourceType } from "../src/types/database";

const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(columns);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  const unprocessedFinished = await fetchAll<{ id: number }>("matches", "id", (q) =>
    q.eq("status", "finished").is("points_processed_at", null)
  );
  console.log(`Matchs finished sans points_processed_at (jamais payés) : ${unprocessedFinished.length}`);
  if (unprocessedFinished.length > 0) console.log("  ids:", unprocessedFinished.map((m) => m.id).join(", "));

  const predictions = await fetchAll<{
    id: number;
    match_id: number;
    user_id: string;
    points_awarded: number | null;
  }>("match_predictions", "id, match_id, user_id, points_awarded", (q) => q.not("points_awarded", "is", null));
  console.log(`Pronostics avec points_awarded renseigné : ${predictions.length}`);

  const ledger = await fetchAll<{ user_id: string; source_type: PointsSourceType; source_id: number; points: number }>(
    "points_ledger",
    "user_id, source_type, source_id, points",
    (q) => q.in("source_type", ["match_score", "match_scorer", "match_assist"])
  );
  console.log(`Lignes points_ledger (match_*) : ${ledger.length}`);

  const ledgerSumByKey = new Map<string, number>();
  const ledgerCountByExactKey = new Map<string, number>();
  for (const row of ledger) {
    const sumKey = `${row.source_id}:${row.user_id}`;
    ledgerSumByKey.set(sumKey, (ledgerSumByKey.get(sumKey) ?? 0) + row.points);
    const exactKey = `${row.source_id}:${row.user_id}:${row.source_type}`;
    ledgerCountByExactKey.set(exactKey, (ledgerCountByExactKey.get(exactKey) ?? 0) + 1);
    if (row.points < 0) console.log(`NEGATIVE_LEDGER_POINTS: ${exactKey} = ${row.points}`);
  }

  let duplicates = 0;
  for (const [key, count] of ledgerCountByExactKey) {
    if (count > 1) {
      duplicates++;
      console.log(`DUPLICATE_LEDGER_KEY: ${key} apparaît ${count} fois`);
    }
  }
  console.log(`Doublons ledger (même user+match+type) : ${duplicates}`);

  const predKeySeen = new Set<string>();
  let mismatches = 0;
  let negativeAwarded = 0;
  for (const pred of predictions) {
    const key = `${pred.match_id}:${pred.user_id}`;
    predKeySeen.add(key);
    const awarded = pred.points_awarded ?? 0;
    if (awarded < 0) {
      negativeAwarded++;
      console.log(`NEGATIVE_POINTS_AWARDED: pred=${pred.id} match=${pred.match_id} user=${pred.user_id} = ${awarded}`);
      continue;
    }
    const ledgerSum = ledgerSumByKey.get(key) ?? 0;
    if (ledgerSum !== awarded) {
      mismatches++;
      console.log(
        `LEDGER_MISMATCH: match=${pred.match_id} user=${pred.user_id} points_awarded=${awarded} somme_ledger=${ledgerSum}`
      );
    }
  }
  console.log(`Pronostics dont le ledger ne correspond pas à points_awarded : ${mismatches}`);
  console.log(`points_awarded négatif : ${negativeAwarded}`);

  let orphanLedgerGroups = 0;
  for (const key of ledgerSumByKey.keys()) {
    if (!predKeySeen.has(key)) {
      orphanLedgerGroups++;
      console.log(`ORPHAN_LEDGER_GROUP: ${key} (${ledgerSumByKey.get(key)} pts) sans pronostic points_awarded correspondant`);
    }
  }
  console.log(`Groupes ledger orphelins (sans pronostic correspondant) : ${orphanLedgerGroups}`);

  console.log("\n=== RÉSUMÉ ===");
  console.log(`Matchs jamais payés : ${unprocessedFinished.length}`);
  console.log(`Doublons ledger : ${duplicates}`);
  console.log(`Incohérences ledger vs points_awarded : ${mismatches}`);
  console.log(`Points négatifs : ${negativeAwarded}`);
  console.log(`Lignes orphelines : ${orphanLedgerGroups}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
