"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export interface DeleteUserState {
  error: string | null;
  success: boolean;
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
