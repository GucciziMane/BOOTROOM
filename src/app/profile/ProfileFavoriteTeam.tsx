"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FavoriteTeamPicker, type LeagueGroup } from "./FavoriteTeamPicker";

export function ProfileFavoriteTeam({
  leagues,
  initialTeamId,
}: {
  leagues: LeagueGroup[];
  initialTeamId: number | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  return (
    <div>
      <FavoriteTeamPicker
        leagues={leagues}
        initialTeamId={initialTeamId}
        onSaved={() => {
          setSaved(true);
          router.refresh();
        }}
      />
      {saved && <p className="mt-3 text-sm text-good">Club favori mis à jour.</p>}
    </div>
  );
}
