"use client";

import { useEffect } from "react";
import Link from "next/link";
import { card, buttonPrimary, linkMuted } from "@/lib/ui";

/**
 * Filet de sécurité global : sans ce fichier, la moindre exception non rattrapée n'importe où
 * dans l'app (rendu, transition, action serveur qui lève au lieu de renvoyer une erreur) fait
 * planter toute la page en un écran blanc "Application error", sans aucun moyen de s'en sortir
 * sans recharger — le layout racine (nav du bas incluse) reste lui affiché autour de ce fallback.
 */
export default function GlobalErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center p-6">
      <div className={`w-full ${card}`}>
        <h1 className="text-xl font-bold">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-mute">
          Ce n&apos;était pas censé arriver. Tu peux réessayer, ou revenir à l&apos;accueil si ça persiste.
        </p>
        <div className="mt-4 flex items-center gap-4">
          <button type="button" onClick={() => retry()} className={buttonPrimary}>
            Réessayer
          </button>
          <Link href="/" className={linkMuted}>
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </main>
  );
}
