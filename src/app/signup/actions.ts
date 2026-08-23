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

  if (!username) {
    return { error: "Pseudo requis.", success: false };
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "boot-room.vercel.app";
  const origin = headersList.get("origin") ?? `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  if (error) {
    if (error.message.includes("duplicate key") || error.message.includes("already registered")) {
      return { error: "Ce pseudo ou cet email est déjà utilisé.", success: false };
    }
    return { error: error.message, success: false };
  }

  return { error: null, success: true };
}
