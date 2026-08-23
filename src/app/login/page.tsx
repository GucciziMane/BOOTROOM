"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "./actions";
import { card, input, buttonPrimary, linkMuted } from "@/lib/ui";

export default function LoginPage() {
  const [error, formAction, isPending] = useActionState(signIn, null);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={formAction} className={`w-full max-w-sm space-y-5 ${card}`}>
        <div>
          <h1 className="text-3xl font-bold">Boot Room</h1>
          <p className="mt-1 text-sm text-mute">Connexion réservée aux membres invités.</p>
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
          <input id="password" name="password" type="password" required className={input} />
        </div>

        {error && <p className="text-sm text-bad">{error}</p>}

        <button type="submit" disabled={isPending} className={`w-full ${buttonPrimary}`}>
          {isPending ? "Connexion..." : "Se connecter"}
        </button>

        <p className="text-sm text-mute">
          Tu as un code d&apos;invitation ?{" "}
          <Link href="/signup" className={linkMuted}>
            Créer un compte
          </Link>
        </p>
      </form>
    </main>
  );
}
