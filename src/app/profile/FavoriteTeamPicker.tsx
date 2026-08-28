"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { setFavoriteTeam } from "./actions";

export interface TeamOption {
  id: number;
  name: string;
  logoUrl: string | null;
}

export interface LeagueGroup {
  id: number;
  name: string;
  flag: string;
  teams: TeamOption[];
}

export function FavoriteTeamPicker({
  leagues,
  initialTeamId,
  onSaved,
}: {
  leagues: LeagueGroup[];
  initialTeamId: number | null;
  onSaved?: (teamId: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(initialTeamId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(teamId: number) {
    setError(null);
    setSelected(teamId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("team_id", String(teamId));
      const res = await setFavoriteTeam({ error: null, success: false }, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      onSaved?.(teamId);
    });
  }

  return (
    <div className="space-y-5">
      {leagues.map((league) => (
        <div key={league.id}>
          <p className="mb-2 text-xs font-bold text-mute">
            {league.flag} {league.name}
          </p>
          <div className="grid grid-cols-5 gap-2">
            {league.teams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                disabled={isPending}
                title={t.name}
                aria-label={t.name}
                className={`flex aspect-square items-center justify-center rounded-xl border-2 p-2 transition-colors disabled:opacity-60 ${
                  selected === t.id ? "border-ink bg-cream" : "border-line hover:border-ink"
                }`}
              >
                {t.logoUrl ? (
                  <Image src={t.logoUrl} alt={t.name} width={28} height={28} className="h-7 w-7 object-contain" />
                ) : (
                  <span className="text-[9px] font-bold text-mute">{t.name.slice(0, 3).toUpperCase()}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
