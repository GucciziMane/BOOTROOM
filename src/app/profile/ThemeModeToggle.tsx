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
      setError("Choisis d’abord un club favori pour activer ce thème.");
      return;
    }

    if (next === useClubTheme) {
      return;
    }

    const previousValue = useClubTheme;

    setError(null);
    setUseClubTheme(next);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("use_club_theme", next ? "1" : "0");

      const response = await setThemeMode(
        { error: null, success: false },
        formData
      );

      if (response.error) {
        setError(response.error);
        setUseClubTheme(previousValue);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="w-full">
      <div
        className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-cream p-1.5"
        role="group"
        aria-label="Thème de l’application"
      >
        <button
          type="button"
          onClick={() => choose(true)}
          disabled={isPending || !hasFavoriteTeam}
          aria-pressed={useClubTheme}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
            useClubTheme
              ? "bg-accent text-paper shadow-sm"
              : "text-mute hover:bg-paper hover:text-ink"
          }`}
        >
          {favoriteTeamLogoUrl ? (
            <Image
              src={favoriteTeamLogoUrl}
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 object-contain"
            />
          ) : (
            <span aria-hidden="true">⚽</span>
          )}

          <span>Mon club</span>
        </button>

        <button
          type="button"
          onClick={() => choose(false)}
          disabled={isPending}
          aria-pressed={!useClubTheme}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
            !useClubTheme
              ? "bg-ink text-paper shadow-sm"
              : "text-mute hover:bg-paper hover:text-ink"
          }`}
        >
          <span aria-hidden="true">✦</span>
          <span>BOOTROOM</span>
        </button>
      </div>

      <p className="mt-2 text-xs leading-5 text-mute">
        {useClubTheme
          ? "Les couleurs de ton club personnalisent les éléments importants."
          : "Le thème BOOTROOM utilise une palette sobre et intemporelle."}
      </p>

      {isPending && (
        <p className="mt-2 text-xs text-mute" role="status">
          Mise à jour du thème…
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
