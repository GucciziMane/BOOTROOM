"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendPushToOthers, sendPushToUserIds } from "@/lib/push/server";
import { extractMentionedUserIds } from "@/lib/chat/mentions";

export interface SendChatMessageState {
  error: string | null;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

export async function sendChatMessage(
  _prevState: SendChatMessageState,
  formData: FormData
): Promise<SendChatMessageState> {
  const content = String(formData.get("content") ?? "").trim();
  const image = formData.get("image");
  const hasImage = image instanceof File && image.size > 0;
  if (!content && !hasImage) return { error: null };
  if (content.length > 2000) return { error: "Message trop long (2000 caractères max)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  let imageUrl: string | null = null;
  if (hasImage) {
    const file = image as File;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return { error: "Format d'image non supporté (JPEG, PNG, WEBP, GIF ou HEIC)." };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: "Image trop lourde (5 Mo max)." };
    }

    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("chat-images")
      .upload(path, file, { contentType: file.type });
    if (uploadError) return { error: "Échec de l'envoi de l'image, réessaie." };

    // Le bucket est privé (voir migration 0030) : on stocke le CHEMIN, jamais une URL — l'affichage
    // passe systématiquement par getChatImageUrl ci-dessous, qui génère une URL signée à la demande
    // (et applique la règle "une seule vue" pour les photos éphémères).
    imageUrl = path;
  }

  // Éphémère seulement pour les photos prises avec l'appareil (bouton caméra) : celles choisies
  // dans la pellicule restent des photos classiques, comme convenu avec l'utilisateur.
  const isEphemeral = hasImage && formData.get("ephemeral") === "1";

  const { error } = await supabase
    .from("chat_messages")
    .insert({ user_id: user.id, content, image_url: imageUrl, is_ephemeral: isEphemeral });
  if (error) return { error: "Échec de l'envoi, réessaie." };

  const { data: profiles } = await supabase.from("profiles").select("id, username");
  const senderName = profiles?.find((p) => p.id === user.id)?.username ?? "Quelqu'un";
  const mentionedUserIds = extractMentionedUserIds(content, profiles ?? []).filter((id) => id !== user.id);
  const pushBody = isEphemeral ? "📸 Photo à voir une fois" : content || "📷 Photo";

  try {
    if (mentionedUserIds.length > 0) {
      await sendPushToUserIds(mentionedUserIds, {
        title: `${senderName} vous a mentionné — 3ème mi-temps`,
        body: pushBody,
        url: "/chat",
      });
    }
    await sendPushToOthers([user.id, ...mentionedUserIds], {
      title: `${senderName} — 3ème mi-temps`,
      body: pushBody,
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

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Résout le chemin de stockage d'une image de chat en URL signée à courte durée de vie — jamais
 * d'URL publique fixe (bucket privé, cf. migration 0030). Pour une photo éphémère vue par
 * quelqu'un d'autre que l'expéditeur, enregistre la vue et refuse d'en générer une seconde : c'est
 * ici, pas côté client, que la règle "une seule vue" est réellement appliquée.
 *
 * Appelée pour toute image affichable directement (message pas encore éphémère-consommé) : à la
 * fois pour la résolution "en arrière-plan" des photos normales/déjà miennes, et à la demande
 * (au tap) pour ouvrir une photo éphémère envoyée par quelqu'un d'autre.
 */
export async function getChatImageUrl(messageId: number): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: message } = await supabase
    .from("chat_messages")
    .select("user_id, image_url, is_ephemeral")
    .eq("id", messageId)
    .maybeSingle();
  if (!message?.image_url) return null;

  if (message.is_ephemeral && message.user_id !== user.id) {
    const { data: existingView } = await supabase
      .from("chat_message_views")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingView) return null; // déjà consommée

    const { error: insertError } = await supabase
      .from("chat_message_views")
      .insert({ message_id: messageId, user_id: user.id });
    // Contrainte unique violée : un onglet dupliqué vient de consommer la vue en même temps.
    if (insertError) return null;
  }

  const { data, error } = await supabase.storage
    .from("chat-images")
    .createSignedUrl(message.image_url, SIGNED_URL_TTL_SECONDS);
  return error ? null : data.signedUrl;
}

/** Appelée uniquement depuis la page chat, qui a déjà l'utilisateur courant sous la main : pas
 * besoin d'un aller-retour getUser() de plus rien que pour le redemander ici. */
export async function markChatAsRead(userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("profiles").update({ chat_last_read_at: new Date().toISOString() }).eq("id", userId);
}
