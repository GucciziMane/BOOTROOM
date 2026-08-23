"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  revalidatePath("/chat");
  return { error: null };
}

export async function markChatAsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("profiles").update({ chat_last_read_at: new Date().toISOString() }).eq("id", user.id);
}
