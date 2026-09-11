"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushToUserIds } from "@/lib/push/server";

export interface UseMidseasonBonusResult {
  error: string | null;
}

/** Utilise le bonus mi-saison de l'appelant (voir migration 0049 + api/cron/midseason-bonus) :
 * inflige son malus (-100/-75/-50 points) à `targetUserId`. Tout passe par le service role — comme
 * points_ledger, midseason_bonuses n'a aucune policy d'écriture cliente ; le seul champ de
 * confiance venant du client est `targetUserId`, tout le reste (montant, éligibilité, expiration)
 * est relu et revérifié ici plutôt que fait confiance depuis le composant appelant. */
export async function spendMidseasonBonus(targetUserId: string): Promise<UseMidseasonBonusResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };
  if (targetUserId === user.id) return { error: "Tu ne peux pas te cibler toi-même." };

  const admin = createServiceRoleClient();

  const [{ data: bonus }, { data: caller }, { data: target }] = await Promise.all([
    admin
      .from("midseason_bonuses")
      .select("id, amount, used_at, expires_at")
      .eq("user_id", user.id)
      .order("season_year", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("profiles").select("username").eq("id", user.id).single(),
    admin.from("profiles").select("username").eq("id", targetUserId).maybeSingle(),
  ]);

  if (!bonus) return { error: "Aucun bonus mi-saison à utiliser." };
  if (bonus.used_at) return { error: "Ce bonus a déjà été utilisé." };
  if (bonus.expires_at <= new Date().toISOString()) return { error: "Ce bonus a expiré." };
  if (!target) return { error: "Joueur introuvable." };

  const { error: updateError } = await admin
    .from("midseason_bonuses")
    .update({ used_at: new Date().toISOString(), target_user_id: targetUserId })
    .eq("id", bonus.id)
    .is("used_at", null); // double-clic/double-tap : la 2e requête ne trouve plus de ligne à mettre à jour
  if (updateError) return { error: "Erreur réseau, réessaie." };

  await admin.from("points_ledger").insert({
    user_id: targetUserId,
    league_id: null,
    source_type: "midseason_malus",
    source_id: bonus.id,
    points: -bonus.amount,
  });

  await admin.from("chat_messages").insert({
    user_id: null,
    is_system: true,
    content: `😈 ${caller?.username ?? "Un joueur"} inflige -${bonus.amount} points à ${target.username} (bonus mi-saison) !`,
  });

  await sendPushToUserIds([targetUserId], {
    title: "Boot Room 😈",
    body: `${caller?.username ?? "Un joueur"} t'a retiré ${bonus.amount} points (bonus mi-saison) !`,
    url: "/leaderboard",
  });

  revalidatePath("/leaderboard");
  return { error: null };
}
