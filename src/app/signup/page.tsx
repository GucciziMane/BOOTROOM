"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp } from "./actions";
import { card, input, buttonPrimary, linkMuted } from "@/lib/ui";

export default function SignupPage() {
  const [error, formAction, isPending] = useActionState(signUp, null);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={formAction} className={`w-full max-w-sm space-y-5 ${card}`}>
        <div>
          <h1 className="text-3xl font-bold">Créer un compte</h1>
          <p className="mt-1 text-sm text-mute">
            Réservé aux 5 membres invités. Un code d&apos;invitation à usage unique est nécessaire.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="username" className="text-sm font-bold">
            Pseudo
          </label>
          <input id="username" name="username" type="text" required className={input} />
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-bold">
            Email
          </label>
          <input id="email" name="email" type="email" required className={input} />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-bold">
            Mot de passe
          </label>
          <input id="password" name="password" type="password" required minLength={6} className={input} />
        </div>

        <div className="space-y-1">
          <label htmlFor="invite_code" className="text-sm font-bold">
            Code d&apos;invitation
          </label>
          <input id="invite_code" name="invite_code" type="text" required className={input} />
        </div>

        {error && <p className="text-sm text-bad">{error}</p>}

        <button type="submit" disabled={isPending} className={`w-full ${buttonPrimary}`}>
          {isPending ? "Création..." : "Créer mon compte"}
        </button>

        <p className="text-sm text-mute">
          Déjà inscrit ?{" "}
          <Link href="/login" className={linkMuted}>
            Se connecter
          </Link>
        </p>
      </form>
    </main>
  );
}
