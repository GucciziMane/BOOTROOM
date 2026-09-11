"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// En dur plutôt que dérivé des headers Host/Origin de la requête : mêmes raisons qu'à l'inscription
// (src/app/signup/actions.ts) — un header falsifié pourrait sinon glisser un lien de réinitialisation
// pointant vers un domaine de phishing dans l'email envoyé par Supabase.
const APP_URL = "https://bootroom.online";

export async function signIn(_prevState: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Email not confirmed")) {
      return "Confirme d'abord ton adresse email (lien envoyé à l'inscription) avant de te connecter.";
    }
    return "Email ou mot de passe incorrect.";
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface RequestPasswordResetState {
  error: string | null;
  success: boolean;
}

export async function requestPasswordReset(
  _prevState: RequestPasswordResetState,
  formData: FormData
): Promise<RequestPasswordResetState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Email requis.", success: false };
  }

  const origin = process.env.NODE_ENV === "development" ? "http://localhost:3000" : APP_URL;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Réutilise la même destination que la confirmation d'inscription (déjà autorisée côté
    // Supabase Auth, cf. signup/actions.ts) plutôt qu'une nouvelle URL — auth/confirm distingue
    // déjà les deux cas via `type` (signup vs recovery) dans le lien reçu par email.
    redirectTo: `${origin}/auth/confirm`,
  });

  // Supabase ne signale jamais si l'email existe ou non (même succès dans les deux cas) —
  // volontaire de sa part pour ne pas permettre de déduire quels emails sont inscrits ; on relaie
  // ce même comportement ici plutôt que de le contourner.
  if (error) {
    return { error: "Une erreur est survenue, réessaie.", success: false };
  }

  return { error: null, success: true };
}
