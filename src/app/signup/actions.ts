"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface SignUpState {
  error: string | null;
  success: boolean;
}

export async function signUp(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const inviteCode = String(formData.get("invite_code") ?? "").trim();

  if (!username || !inviteCode) {
    return { error: "Pseudo et code d'invitation requis.", success: false };
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "boot-room.vercel.app";
  const origin = headersList.get("origin") ?? `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, invite_code: inviteCode },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  if (error) {
    // Le trigger handle_new_user() rejette les codes invalides/déjà utilisés
    // avec ce message précis (voir supabase/migrations/0001_init.sql).
    if (error.message.includes("code d'invitation")) {
      return { error: "Code d'invitation invalide ou déjà utilisé.", success: false };
    }
    return { error: error.message, success: false };
  }

  return { error: null, success: true };
}
