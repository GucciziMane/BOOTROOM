"use client";

import { useRouter } from "next/navigation";
import { FavoriteTeamPicker, type LeagueGroup } from "./profile/FavoriteTeamPicker";
import { card } from "@/lib/ui";

// Plus de mode "trophée" sans club (cf. page.tsx) : l'app entière repose désormais sur le club
// favori, donc ce choix n'est plus sautable — pas de bouton "plus tard" ni de mémorisation de
// refus. Le parent (page.tsx) ne monte ce composant que tant que `favorite_team_id` est vide ;
// une fois enregistré, `router.refresh()` fait disparaître ce prompt de lui-même.
export function FavoriteTeamOnboarding({ leagues }: { leagues: LeagueGroup[] }) {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-surface-inverse/40 p-4 sm:items-center">
      <div className={`w-full max-w-sm ${card}`}>
        <h2 className="text-xl font-bold">Choisis ton club favori ⚽</h2>
        <p className="mb-4 mt-1 text-sm text-mute">
          Boot Room s&apos;organise autour de lui : prochain match, classement, forme... Tu pourras le changer plus
          tard dans ton profil.
        </p>
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <FavoriteTeamPicker leagues={leagues} initialTeamId={null} onSaved={() => router.refresh()} />
        </div>
      </div>
    </div>
  );
}
