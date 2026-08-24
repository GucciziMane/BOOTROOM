"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const APP_URL = "https://bootroom.online";

export interface DeleteUserState {
  error: string | null;
  success: boolean;
}

export interface RefreshScoresState {
  error: string | null;
  success: boolean;
  summary: string | null;
}

async function requireAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Non connecté.";

  const { data: callerProfile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!callerProfile?.is_admin) return "Réservé aux administrateurs.";

  return null;
}

/** Déclenche à la demande le même enchaînement que le workflow GitHub (toutes les 2h) :
 * sync des calendriers/scores puis calcul des points, pour ne pas attendre le prochain passage. */
export async function refreshScores(
  _prevState: RefreshScoresState,
  _formData: FormData
): Promise<RefreshScoresState> {
  const authError = await requireAdmin();
  if (authError) return { error: authError, success: false, summary: null };

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return { error: "CRON_SECRET manquant côté serveur.", success: false, summary: null };

  const headers = { Authorization: `Bearer ${cronSecret}` };

  try {
    const fixturesRes = await fetch(`${APP_URL}/api/cron/sync-fixtures`, { headers, cache: "no-store" });
    const fixturesJson = await fixturesRes.json();
    if (!fixturesRes.ok) throw new Error(fixturesJson?.error ?? "Échec de la synchronisation des matchs.");

    const scoringRes = await fetch(`${APP_URL}/api/cron/process-scoring`, { headers, cache: "no-store" });
    const scoringJson = await scoringRes.json();
    if (!scoringRes.ok) throw new Error(scoringJson?.error ?? "Échec du calcul des points.");

    const matchesSynced = ((fixturesJson.matches ?? []) as Array<{ matches: number }>).reduce(
      (sum, l) => sum + (l.matches ?? 0),
      0
    );
    const matchesScored = scoringJson.matches?.processed ?? 0;

    revalidatePath("/", "layout");

    return {
      error: null,
      success: true,
      summary: `${matchesSynced} match(s) synchronisé(s), ${matchesScored} match(s) noté(s).`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erreur inconnue.", success: false, summary: null };
  }
}

export async function deleteUser(_prevState: DeleteUserState, formData: FormData): Promise<DeleteUserState> {
  const targetUserId = String(formData.get("user_id") ?? "");
  if (!targetUserId) return { error: "Utilisateur manquant.", success: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  if (targetUserId === user.id) {
    return { error: "Tu ne peux pas supprimer ton propre compte depuis cette page.", success: false };
  }

  const { data: callerProfile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!callerProfile?.is_admin) {
    return { error: "Réservé aux administrateurs.", success: false };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.deleteUser(targetUserId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/admin");
  return { error: null, success: true };
}
