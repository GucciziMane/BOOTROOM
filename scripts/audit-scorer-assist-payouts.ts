// Audit indépendant, lecture seule : pour chaque pronostic buteur/passeur d'un match déjà traité
// (points_processed_at non nul), recalcule la couverture buteur/passeur — y compris la "garantie
// remplaçant" (src/lib/scoring/points.ts, predictionCoveredByPlayer) — à partir des VRAIES données
// actuelles (match_goals, match_substitutions, tiers) et compare au montant réellement présent
// dans points_ledger (source_type='match_scorer'/'match_assist'), pas juste à points_awarded
// (qui peut lui-même être périmé, voir [[project_p1_bundesliga_ledger_gap_deferred]]).
//
// Réutilise les VRAIES fonctions de scoring (import direct), jamais une réimplémentation
// parallèle qui pourrait diverger silencieusement de la logique réelle.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/audit-scorer-assist-payouts.ts
import { createClient } from "@supabase/supabase-js";
import { computeScorerAssistAward } from "../src/lib/scoring/points";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = (supabase.from(table) as any).select(columns);
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
  const matches = await fetchAll<{ id: number; season_id: number; league_id: number }>(
    "matches",
    "id, season_id, league_id",
    (q: any) => q.eq("status", "finished").not("points_processed_at", "is", null)
  );
  console.log(`Matchs déjà traités (points_processed_at non nul) : ${matches.length}`);
  const matchIds = matches.map((m) => m.id);
  const seasonIds = [...new Set(matches.map((m) => m.season_id))];
  const seasonByMatch = new Map(matches.map((m) => [m.id, m.season_id]));

  const predictions = await fetchAll<{
    id: number;
    match_id: number;
    user_id: string;
    predicted_scorer_player_id: number | null;
    predicted_assist_player_id: number | null;
    is_doubled: boolean;
  }>(
    "match_predictions",
    "id, match_id, user_id, predicted_scorer_player_id, predicted_assist_player_id, is_doubled",
    (q: any) => q.in("match_id", matchIds)
  );
  const withPick = predictions.filter((p) => p.predicted_scorer_player_id != null || p.predicted_assist_player_id != null);
  console.log(`Pronostics avec un buteur et/ou un passeur choisi : ${withPick.length}`);

  const goals = await fetchAll<{ match_id: number; player_id: number | null; assist_player_id: number | null }>(
    "match_goals",
    "match_id, player_id, assist_player_id",
    (q: any) => q.in("match_id", matchIds)
  );
  const subs = await fetchAll<{ match_id: number; player_out_id: number | null; player_in_id: number | null }>(
    "match_substitutions",
    "match_id, player_out_id, player_in_id",
    (q: any) => q.in("match_id", matchIds)
  );
  const scorerTierRows = await fetchAll<{ player_id: number; tier: number; season_id: number }>(
    "player_scoring_tier",
    "player_id, tier, season_id",
    (q: any) => q.in("season_id", seasonIds)
  );
  const assistTierRows = await fetchAll<{ player_id: number; tier: number; season_id: number }>(
    "player_assist_tier",
    "player_id, tier, season_id",
    (q: any) => q.in("season_id", seasonIds)
  );
  const { data: tierPoints } = await supabase.from("match_scorer_tier_points").select("tier, points");
  const { data: assistTierPoints } = await supabase.from("match_assist_tier_points").select("tier, points");
  const tierPointsMap = new Map((tierPoints ?? []).map((t: any) => [t.tier, t.points]));
  const assistTierPointsMap = new Map((assistTierPoints ?? []).map((t: any) => [t.tier, t.points]));

  const ledger = await fetchAll<{ user_id: string; source_type: string; source_id: number; points: number }>(
    "points_ledger",
    "user_id, source_type, source_id, points",
    (q: any) => q.in("source_id", matchIds).in("source_type", ["match_scorer", "match_assist"])
  );

  const scorersByMatch = new Map<number, Set<number>>();
  const assistersByMatch = new Map<number, Set<number>>();
  for (const g of goals) {
    if (g.player_id != null) {
      if (!scorersByMatch.has(g.match_id)) scorersByMatch.set(g.match_id, new Set());
      scorersByMatch.get(g.match_id)!.add(g.player_id);
    }
    if (g.assist_player_id != null) {
      if (!assistersByMatch.has(g.match_id)) assistersByMatch.set(g.match_id, new Set());
      assistersByMatch.get(g.match_id)!.add(g.assist_player_id);
    }
  }
  const substituteByMatch = new Map<number, Map<number, number>>();
  for (const s of subs) {
    if (s.player_out_id == null || s.player_in_id == null) continue;
    if (!substituteByMatch.has(s.match_id)) substituteByMatch.set(s.match_id, new Map());
    substituteByMatch.get(s.match_id)!.set(s.player_out_id, s.player_in_id);
  }
  // Un joueur peut en théorie avoir un tier différent sur deux saisons (ex: promu puis relégué) :
  // clé composite (season, player), pas juste player_id comme le fait process-scoring (qui ne
  // traite qu'un lot de matchs à la fois, donc une seule saison par joueur en pratique dans son
  // propre batch) — cet audit, lui, couvre TOUTES les saisons à la fois dans une seule passe.
  const scorerTierByKey = new Map(scorerTierRows.map((r) => [`${r.season_id}:${r.player_id}`, r.tier]));
  const assistTierByKey = new Map(assistTierRows.map((r) => [`${r.season_id}:${r.player_id}`, r.tier]));

  const ledgerPointsByKey = new Map<string, number>();
  for (const row of ledger) {
    const key = `${row.source_id}:${row.user_id}:${row.source_type}`;
    ledgerPointsByKey.set(key, (ledgerPointsByKey.get(key) ?? 0) + row.points);
  }

  let scorerMismatches = 0;
  let assistMismatches = 0;
  let substituteGuaranteeHits = 0;

  for (const pred of withPick) {
    const seasonId = seasonByMatch.get(pred.match_id)!;
    const actualScorers = scorersByMatch.get(pred.match_id) ?? new Set();
    const actualAssisters = assistersByMatch.get(pred.match_id) ?? new Set();
    const substituteByPlayer = substituteByMatch.get(pred.match_id) ?? new Map();

    // Adaptateurs season-aware par-dessus les Map génériques attendues par computeScorerAssistAward
    // (qui, lui, suppose un seul tier par joueur — correct dans son contexte d'appel réel, pas
    // nécessairement ici où plusieurs saisons se mélangent).
    const scorerTierByPlayer = new Map<number, number>();
    if (pred.predicted_scorer_player_id != null) {
      const t = scorerTierByKey.get(`${seasonId}:${pred.predicted_scorer_player_id}`);
      if (t != null) scorerTierByPlayer.set(pred.predicted_scorer_player_id, t);
    }
    const assistTierByPlayer = new Map<number, number>();
    if (pred.predicted_assist_player_id != null) {
      const t = assistTierByKey.get(`${seasonId}:${pred.predicted_assist_player_id}`);
      if (t != null) assistTierByPlayer.set(pred.predicted_assist_player_id, t);
    }

    const { scorerPoints, assistPoints } = computeScorerAssistAward(
      pred,
      actualScorers,
      actualAssisters,
      substituteByPlayer,
      scorerTierByPlayer,
      assistTierByPlayer,
      tierPointsMap,
      assistTierPointsMap
    );

    // Repère les cas couverts uniquement grâce à la garantie remplaçant (le joueur pronostiqué
    // n'a pas lui-même marqué/passé, mais son remplaçant si) — juste pour le signaler séparément
    // dans le résumé, demande explicite de l'utilisateur de vérifier cette garantie en particulier.
    if (
      pred.predicted_scorer_player_id != null &&
      !actualScorers.has(pred.predicted_scorer_player_id) &&
      scorerPoints > 0
    ) {
      substituteGuaranteeHits++;
      console.log(
        `GARANTIE_REMPLAÇANT (buteur) : match=${pred.match_id} user=${pred.user_id} joueur_pronostiqué=${pred.predicted_scorer_player_id} -> remplaçant a marqué, ${scorerPoints} pts`
      );
    }
    if (
      pred.predicted_assist_player_id != null &&
      !actualAssisters.has(pred.predicted_assist_player_id) &&
      assistPoints > 0
    ) {
      substituteGuaranteeHits++;
      console.log(
        `GARANTIE_REMPLAÇANT (passeur) : match=${pred.match_id} user=${pred.user_id} joueur_pronostiqué=${pred.predicted_assist_player_id} -> remplaçant a délivré la passe, ${assistPoints} pts`
      );
    }

    const scorerLedger = ledgerPointsByKey.get(`${pred.match_id}:${pred.user_id}:match_scorer`) ?? 0;
    const assistLedger = ledgerPointsByKey.get(`${pred.match_id}:${pred.user_id}:match_assist`) ?? 0;

    // player_scoring_tier/player_assist_tier ne sont PAS des instantanés historiques : ils sont
    // recalculés en continu pendant la saison (compute-scoring-tiers), donc le tier d'AUJOURD'HUI
    // d'un joueur diffère légitimement de celui en vigueur au moment où un match passé a été noté
    // — un écart de VALEUR seule (les deux > 0, juste un montant différent) n'est donc pas fiable
    // comme preuve d'erreur ici, seulement un signal "tier a dérivé depuis, à ignorer". Seule une
    // couverture binaire incohérente (payé 0 alors que la couverture recalculée dit oui, ou payé
    // un montant alors qu'elle dit non) reste un vrai signal, intemporel : la question "qui a
    // marqué/passé, et via quel remplaçant" ne change jamais après coup, contrairement au tier.
    if (scorerPoints > 0 && scorerLedger === 0) {
      scorerMismatches++;
      console.log(
        `SCORER_IMPAYÉ : match=${pred.match_id} user=${pred.user_id} couverture=oui ledger=0 (devrait toucher ${scorerPoints} pts au tier actuel)`
      );
    } else if (scorerPoints === 0 && scorerLedger > 0) {
      scorerMismatches++;
      console.log(
        `SCORER_PAYÉ_À_TORT : match=${pred.match_id} user=${pred.user_id} couverture=non ledger=${scorerLedger}`
      );
    } else if (scorerLedger > 0 && scorerPoints > 0 && scorerLedger !== scorerPoints) {
      console.log(
        `(tier a dérivé, pas une erreur) scorer : match=${pred.match_id} user=${pred.user_id} recalculé_tier_actuel=${scorerPoints} payé_à_l'époque=${scorerLedger}`
      );
    }
    if (assistPoints > 0 && assistLedger === 0) {
      assistMismatches++;
      console.log(
        `ASSIST_IMPAYÉ : match=${pred.match_id} user=${pred.user_id} couverture=oui ledger=0 (devrait toucher ${assistPoints} pts au tier actuel)`
      );
    } else if (assistPoints === 0 && assistLedger > 0) {
      assistMismatches++;
      console.log(
        `ASSIST_PAYÉ_À_TORT : match=${pred.match_id} user=${pred.user_id} couverture=non ledger=${assistLedger}`
      );
    } else if (assistLedger > 0 && assistPoints > 0 && assistLedger !== assistPoints) {
      console.log(
        `(tier a dérivé, pas une erreur) passeur : match=${pred.match_id} user=${pred.user_id} recalculé_tier_actuel=${assistPoints} payé_à_l'époque=${assistLedger}`
      );
    }
  }

  console.log("\n=== RÉSUMÉ ===");
  console.log(`Pronostics buteur/passeur vérifiés : ${withPick.length}`);
  console.log(`Couvertures via la garantie remplaçant trouvées : ${substituteGuaranteeHits}`);
  console.log(`VRAIES anomalies buteur (couverture binaire incohérente) : ${scorerMismatches}`);
  console.log(`VRAIES anomalies passeur (couverture binaire incohérente) : ${assistMismatches}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
