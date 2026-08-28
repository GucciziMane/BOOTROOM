"use client";

import { useEffect } from "react";
import { darken, ensureReadableOnLight, mixWithWhite } from "@/lib/color";

const PROPERTIES = ["--color-accent", "--color-accent-hover", "--color-cream", "--color-line"];

/** Applique (ou retire) la teinte du club favori sur les variables CSS globales : fond, bordures
 * et accent, pas seulement les boutons — sinon le changement passe quasiment inaperçu. */
export function ThemeApplier({ enabled, primaryColor }: { enabled: boolean; primaryColor: string | null }) {
  useEffect(() => {
    const root = document.documentElement.style;
    if (enabled && primaryColor) {
      const accent = ensureReadableOnLight(primaryColor);
      root.setProperty("--color-accent", accent);
      root.setProperty("--color-accent-hover", darken(accent, 0.82));
      root.setProperty("--color-cream", mixWithWhite(primaryColor, 0.88));
      root.setProperty("--color-line", mixWithWhite(primaryColor, 0.68));
    } else {
      for (const prop of PROPERTIES) root.removeProperty(prop);
    }
  }, [enabled, primaryColor]);

  return null;
}
