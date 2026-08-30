"use server";

import { createClient } from "@/lib/supabase/server";

// En dur plutôt que dérivé des headers Host/Origin de la requête : ces headers
// sont fournis par le client et peuvent être falsifiés, ce qui permettrait de
// glisser un lien de confirmation pointant vers un domaine de phishing dans
// l'email envoyé par Supabase.
const APP_URL = "https://bootroom.online";

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

  const origin = process.env.NODE_ENV === "development" ? "http://localhost:3000" : APP_URL;

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
