"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendPushToOthers } from "@/lib/push/server";

export interface SendChatMessageState {
  error: string | null;
}

export async function sendChatMessage(
  _prevState: SendChatMessageState,
  formData: FormData
): Promise<SendChatMessageState> {
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { error: null };
  if (content.length > 2000) return { error: "Message trop long (2000 caractères max)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  const { error } = await supabase.from("chat_messages").insert({ user_id: user.id, content });
  if (error) return { error: error.message };

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();
  try {
    await sendPushToOthers(user.id, {
      title: `${profile?.username ?? "Quelqu'un"} — 3ème mi-temps`,
      body: content,
      url: "/chat",
    });
  } catch {
    // Le message est déjà enregistré : un souci d'envoi push ne doit pas faire échouer l'action.
  }

  revalidatePath("/chat");
  return { error: null };
}

export async function subscribeToPush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  return { error: error?.message ?? null };
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function markChatAsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("profiles").update({ chat_last_read_at: new Date().toISOString() }).eq("id", user.id);
}
