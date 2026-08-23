"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signUp(_prevState: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const inviteCode = String(formData.get("invite_code") ?? "").trim();

  if (!username || !inviteCode) {
    return "Pseudo et code d'invitation requis.";
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, invite_code: inviteCode } },
  });

  if (error) {
    // Le trigger handle_new_user() rejette les codes invalides/déjà utilisés
    // avec ce message précis (voir supabase/migrations/0001_init.sql).
    if (error.message.includes("code d'invitation")) {
      return "Code d'invitation invalide ou déjà utilisé.";
    }
    return error.message;
  }

  redirect("/");
}
