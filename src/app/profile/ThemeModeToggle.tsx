"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { setThemeMode } from "./actions";

export function ThemeModeToggle({
  initialUseClubTheme,
  favoriteTeamLogoUrl,
  hasFavoriteTeam,
}: {
  initialUseClubTheme: boolean;
  favoriteTeamLogoUrl: string | null;
  hasFavoriteTeam: boolean;
}) {
  const router = useRouter();
  const [useClubTheme, setUseClubTheme] = useState(initialUseClubTheme);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(next: boolean) {
    if (next && !hasFavoriteTeam) {
      setError("Choisis d'abord un club favori ci-dessus.");
      return;
    }
    setError(null);
    setUseClubTheme(next);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("use_club_theme", next ? "1" : "0");
        const res = await setThemeMode({ error: null, success: false }, formData);
        if (res.error) {
          setError(res.error);
          setUseClubTheme(!next);
          return;
        }
        router.refresh();
      } catch {
        setError("Erreur réseau, réessaie.");
        setUseClubTheme(!next);
      }
    });
  }

  return (
    <div>
      <div className="inline-flex items-center gap-1 rounded-full bg-cream p-1">
        <button
          type="button"
          onClick={() => choose(true)}
          disabled={isPending}
          title="Thème du club favori"
          aria-pressed={useClubTheme}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition-all disabled:opacity-60 ${
            useClubTheme ? "bg-accent ring-2 ring-paper" : "opacity-50 hover:opacity-80"
          }`}
        >
          {favoriteTeamLogoUrl ? (
            <Image src={favoriteTeamLogoUrl} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
          ) : (
            <span className="text-xs">⚽</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          disabled={isPending}
          title="Thème de base"
          aria-pressed={!useClubTheme}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs transition-all disabled:opacity-60 ${
            !useClubTheme ? "bg-ink text-paper ring-2 ring-paper" : "opacity-50 hover:opacity-80"
          }`}
        >
          🏆
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
