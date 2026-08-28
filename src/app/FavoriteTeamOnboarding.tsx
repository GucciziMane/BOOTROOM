"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FavoriteTeamPicker, type LeagueGroup } from "./profile/FavoriteTeamPicker";
import { card, linkMuted } from "@/lib/ui";

const DISMISS_KEY = "favorite-team-prompt-dismissed";

export function FavoriteTeamOnboarding({ leagues }: { leagues: LeagueGroup[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Lu après montage : on ne veut pas ré-afficher le prompt à chaque rendu de page dans la
    // même session si l'utilisateur a déjà cliqué "plus tard", mais il réapparaît à la
    // prochaine vraie connexion (nouvelle session = sessionStorage vidé).
    let alreadyDismissed = false;
    try {
      alreadyDismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // Stockage indisponible (navigation privée, etc.) : on affiche le prompt par défaut.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(alreadyDismissed);
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Sans conséquence : le prompt réapparaîtra simplement au prochain chargement.
    }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div className={`w-full max-w-sm ${card}`}>
        <h2 className="text-xl font-bold">Choisis ton club favori ⚽</h2>
        <p className="mb-4 mt-1 text-sm text-mute">
          Il s&apos;affichera en petit sur ton avatar. Tu pourras le changer plus tard dans ton profil.
        </p>
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <FavoriteTeamPicker
            leagues={leagues}
            initialTeamId={null}
            onSaved={() => {
              dismiss();
              router.refresh();
            }}
          />
        </div>
        <button type="button" onClick={dismiss} className={`mt-4 text-sm ${linkMuted}`}>
          Plus tard
        </button>
      </div>
    </div>
  );
}
