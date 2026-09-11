import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { LEADERBOARD_RESET_KEY } from "@/lib/leaderboard-reset";

export interface LedgerRow {
  user_id: string;
  league_id: number | null;
  points: number;
  created_at: string;
}

export interface LeaderboardLedger {
  /** Scopé aux ligues actives et, si une remise à zéro existe, aux points postérieurs à sa date —
   * c'est ce sous-ensemble qui alimente le classement public affiché à tout le monde. */
  ledger: LedgerRow[];
  /** Même scope de ligues actives, mais SANS filtrer sur la remise à zéro — utilisé pour le
   * classement privé "Entre nous" (voir leaderboard/page.tsx), qui garde les totaux complets. */
  ledgerAllTime: LedgerRow[];
  /** Somme de `ledger` par joueur — le total affiché sur le classement général. */
  totalByUser: Map<string, number>;
  /** Date de la remise à zéro (app_settings, LEADERBOARD_RESET_KEY), ou `null` si aucune —
   * renvoyée pour que l'appelant puisse filtrer d'autres données (pronostics, etc.) avec la même
   * coupure que le ledger. */
  resetAt: string | null;
}

/** Charge et filtre le ledger de points exactement comme le classement affiché (voir
 * leaderboard/page.tsx) : ligues actives uniquement, remise à zéro (app_settings,
 * LEADERBOARD_RESET_KEY) si elle existe. Partagé avec le cron d'attribution du bonus mi-saison
 * (src/app/api/cron/midseason-bonus/route.ts) pour qu'il calcule exactement le même top 3 que
 * celui que tout le monde voit à l'écran — deux implémentations séparées auraient fini par
 * diverger au premier changement de l'une des deux. */
export async function fetchLeaderboardTotals(
  supabase: SupabaseClient<Database>,
  activeLeagueIds: Set<number>
): Promise<LeaderboardLedger> {
  const [{ data: ledgerAll }, { data: resetSetting }] = await Promise.all([
    supabase.from("points_ledger").select("user_id, league_id, points, created_at"),
    supabase.from("app_settings").select("value").eq("key", LEADERBOARD_RESET_KEY).maybeSingle(),
  ]);

  const ledgerAllTime = (ledgerAll ?? []).filter((row) => !row.league_id || activeLeagueIds.has(row.league_id));
  const resetAt = resetSetting?.value ?? null;
  const ledger = resetAt ? ledgerAllTime.filter((row) => row.created_at >= resetAt) : ledgerAllTime;

  const totalByUser = new Map<string, number>();
  for (const row of ledger) totalByUser.set(row.user_id, (totalByUser.get(row.user_id) ?? 0) + row.points);

  return { ledger, ledgerAllTime, totalByUser, resetAt };
}
