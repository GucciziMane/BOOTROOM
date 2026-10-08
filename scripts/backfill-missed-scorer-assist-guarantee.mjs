// Backfill ponctuel pour 4 matchs identifiés par scripts/audit-scorer-assist-payouts.ts
// (2026-10-08) : la garantie remplaçant buteur/passeur n'avait jamais été appliquée après coup
// pour ces matchs, parce que match_goals avait déjà des lignes (écrites par live-tick, pour
// l'affichage en direct) au moment où sync-fixtures tentait sa réconciliation tardive — voir le
// correctif dans src/app/api/cron/sync-fixtures/route.ts (saveMatchEvents) qui empêche cette
// lacune de se reproduire. Ici, on rejoue UNE FOIS la même fonction réelle
// (awardLateScorerAssistPoints, jamais une logique réécrite à la main) pour les matchs déjà
// coincés avant ce correctif.
//
// NE TOUCHE PAS aux 2 lignes Bundesliga déjà documentées comme "non-déterministe, à ne pas
// backfiller" (matchs 1078/1073, voir mémoire project_p1_bundesliga_ledger_gap_deferred) — leur
// points_awarded total ne correspond déjà pas à un recalcul propre pour le score lui-même, cette
// incertitude existante n'est pas résolue ici, seulement pas aggravée en les laissant intactes.
//
// Idempotent (awardLateScorerAssistPoints ne paye jamais deux fois, voir son propre
// "alreadyAwarded" + upsert ignoreDuplicates sur points_ledger).
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/backfill-missed-scorer-assist-guarantee.mjs
import { createClient } from "@supabase/supabase-js";
import { awardLateScorerAssistPoints } from "../src/app/api/cron/process-scoring/route";

const MATCH_IDS = [19, 725, 1076, 1077];

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: matches } = await supabase.from("matches").select("id, league_id, season_id").in("id", MATCH_IDS);

  for (const match of matches) {
    const [{ data: goals }, { data: subs }] = await Promise.all([
      supabase.from("match_goals").select("player_id, assist_player_id").eq("match_id", match.id),
      supabase.from("match_substitutions").select("player_out_id, player_in_id").eq("match_id", match.id),
    ]);
    const result = await awardLateScorerAssistPoints(supabase, match.id, match.league_id, match.season_id, goals ?? [], subs ?? []);
    console.log(`match ${match.id} : ${result.awarded} ligne(s) de points_ledger ajoutée(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
