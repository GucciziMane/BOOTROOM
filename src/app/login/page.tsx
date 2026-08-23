"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "./actions";
import { card, input, buttonPrimary, linkMuted, bannerNeutral, bannerWarn } from "@/lib/ui";

function ConfirmationBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get("confirmed")) {
    return <div className={`mb-4 ${bannerNeutral}`}>Email confirmé ! Tu peux maintenant te connecter.</div>;
  }
  if (searchParams.get("confirm_error")) {
    return <div className={`mb-4 ${bannerWarn}`}>Le lien de confirmation est invalide ou a expiré.</div>;
  }
  return null;
}

export default function LoginPage() {
  const [error, formAction, isPending] = useActionState(signIn, null);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <ConfirmationBanner />
        </Suspense>

        <form action={formAction} className={`space-y-5 ${card}`}>
          <div>
            <h1 className="text-3xl font-bold">Boot Room</h1>
            <p className="mt-1 text-sm text-mute">Pronostics entre amis sur les 5 grands championnats.</p>
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
            Pas encore de compte ?{" "}
            <Link href="/signup" className={linkMuted}>
              Créer un compte
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
