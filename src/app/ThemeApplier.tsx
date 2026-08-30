"use client";

import { useEffect } from "react";
import Image from "next/image";
import { darken, ensureReadableOnLight, mixWithWhite } from "@/lib/color";

const ROOT_PROPERTIES = [
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-soft",
  "--color-line",
  "--club-primary",
  "--club-primary-soft",
  "--club-secondary",
  "--club-gradient",
];

function rgbaFromHex(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(79, 70, 229, ${alpha})`;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Applique un thème adaptatif au club favori.
 *
 * La structure de l'application reste neutre. Les couleurs du club servent
 * aux éléments interactifs, bordures, indicateurs et lueurs légères afin
 * de conserver une interface lisible quel que soit le club sélectionné.
 */
export function ThemeApplier({
  enabled,
  primaryColor,
  secondaryColor,
}: {
  enabled: boolean;
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  useEffect(() => {
    const root = document.documentElement.style;

    if (enabled && primaryColor) {
      const accent = ensureReadableOnLight(primaryColor);
      const secondary = secondaryColor ?? primaryColor;

      root.setProperty("--color-accent", accent);
      root.setProperty("--color-accent-hover", darken(accent, 0.84));
      root.setProperty("--color-accent-soft", rgbaFromHex(accent, 0.14));
      root.setProperty("--color-line", mixWithWhite(primaryColor, 0.72));

      root.setProperty("--club-primary", accent);
      root.setProperty("--club-primary-soft", rgbaFromHex(accent, 0.14));
      root.setProperty("--club-secondary", secondary);
      root.setProperty(
        "--club-gradient",
        `linear-gradient(135deg, ${rgbaFromHex(accent, 0.18)}, ${rgbaFromHex(secondary, 0.08)})`
      );

      document.documentElement.dataset.clubTheme = "active";
      return;
    }

    for (const property of ROOT_PROPERTIES) {
      root.removeProperty(property);
    }

    delete document.documentElement.dataset.clubTheme;
  }, [enabled, primaryColor, secondaryColor]);

  return null;
}

/**
 * Blason facultatif en filigrane. Il reste volontairement très discret pour
 * ne jamais réduire le contraste ni perturber la lecture.
 */
export function ClubCrestWatermark({
  enabled,
  crestUrl,
}: {
  enabled: boolean;
  crestUrl: string | null;
}) {
  if (!enabled || !crestUrl) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center overflow-hidden"
      aria-hidden="true"
    >
      <Image
        src={crestUrl}
        alt=""
        width={520}
        height={520}
        className="h-[66vmin] w-[66vmin] max-w-none object-contain opacity-[0.07]"
        priority={false}
      />
    </div>
  );
}
