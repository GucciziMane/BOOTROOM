"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type RequestPasswordResetState } from "../actions";
import { card, input, buttonPrimary, linkMuted, bannerNeutral } from "@/lib/ui";

const initialState: RequestPasswordResetState = { error: null, success: false };

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, initialState);

  if (state.success) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className={`w-full max-w-sm space-y-4 ${card}`}>
          <h1 className="text-2xl font-bold">Email envoyé</h1>
          <div className={bannerNeutral}>
            Si un compte existe avec cet email, un lien de réinitialisation vient d&rsquo;être
            envoyé — vérifie ta boîte mail (et les spams).
          </div>
          <Link href="/login" className={`block text-center text-sm ${linkMuted}`}>
            Retour à la connexion
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={formAction} className={`w-full max-w-sm space-y-5 ${card}`}>
        <div>
          <h1 className="text-3xl font-bold">Mot de passe oublié</h1>
          <p className="mt-1 text-sm text-mute">
            Indique ton email, on t&rsquo;envoie un lien pour choisir un nouveau mot de passe.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-bold">
            Email
          </label>
          <input id="email" name="email" type="email" required className={input} />
        </div>

        {state.error && <p className="text-sm text-bad">{state.error}</p>}

        <button type="submit" disabled={isPending} className={`w-full ${buttonPrimary}`}>
          {isPending ? "Envoi..." : "Envoyer le lien"}
        </button>

        <p className="text-sm text-mute">
          <Link href="/login" className={linkMuted}>
            Retour à la connexion
          </Link>
        </p>
      </form>
    </main>
  );
}
