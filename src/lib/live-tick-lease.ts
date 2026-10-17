import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// Bail de la chaîne live-tick (app_settings.live_tick_lease = "<échéance ISO>|<jeton>"), partagé
// entre live-tick (qui le prend, le passe de tranche en tranche et le libère) et sync-fixtures (qui
// ne publie AUCUN réveil tant qu'il est tenu — y compris pendant qu'une chaîne attend en silence le
// prochain coup d'envoi, sans tick ni battement). Voir live-tick/route.ts.
export const LIVE_TICK_LEASE_KEY = "live_tick_lease";
export const RELEASED_LEASE_VALUE = "1970-01-01T00:00:00.000Z|none";

export async function isLiveTickLeaseHeld(supabase: ServiceClient): Promise<boolean> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", LIVE_TICK_LEASE_KEY).maybeSingle();
  if (!data?.value) return false;
  const expiry = new Date(data.value.split("|")[0]).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

export async function setLiveTickLease(supabase: ServiceClient, untilMs: number, token: string): Promise<void> {
  await supabase
    .from("app_settings")
    .upsert({ key: LIVE_TICK_LEASE_KEY, value: `${new Date(untilMs).toISOString()}|${token}` }, { onConflict: "key" });
}
