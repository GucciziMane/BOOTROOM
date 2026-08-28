"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendPushToOthers, sendPushToUserIds } from "@/lib/push/server";
import { extractMentionedUserIds } from "@/lib/chat/mentions";

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

  const { data: profiles } = await supabase.from("profiles").select("id, username");
  const senderName = profiles?.find((p) => p.id === user.id)?.username ?? "Quelqu'un";
  const mentionedUserIds = extractMentionedUserIds(content, profiles ?? []).filter((id) => id !== user.id);

  try {
    if (mentionedUserIds.length > 0) {
      await sendPushToUserIds(mentionedUserIds, {
        title: `${senderName} vous a mentionné — 3ème mi-temps`,
        body: content,
        url: "/chat",
      });
    }
    await sendPushToOthers([user.id, ...mentionedUserIds], {
      title: `${senderName} — 3ème mi-temps`,
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

/** Une seule réaction par utilisateur et par message : en choisir une nouvelle remplace la
 * précédente, recliquer la même l'enlève (comme les réactions Instagram DM). */
export async function toggleReaction(messageId: number, emoji: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("chat_message_reactions")
    .select("id, emoji")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.emoji === emoji) {
    await supabase.from("chat_message_reactions").delete().eq("id", existing.id);
  } else if (existing) {
    await supabase.from("chat_message_reactions").update({ emoji }).eq("id", existing.id);
  } else {
    await supabase.from("chat_message_reactions").insert({ message_id: messageId, user_id: user.id, emoji });
  }

  revalidatePath("/chat");
}

export async function markChatAsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("profiles").update({ chat_last_read_at: new Date().toISOString() }).eq("id", user.id);
}
