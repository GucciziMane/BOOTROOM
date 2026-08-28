"use client";

import { useEffect } from "react";
import { darken, ensureReadableOnLight } from "@/lib/color";

/** Applique (ou retire) la teinte du club favori sur les variables CSS globales. */
export function ThemeApplier({ enabled, primaryColor }: { enabled: boolean; primaryColor: string | null }) {
  useEffect(() => {
    const root = document.documentElement.style;
    if (enabled && primaryColor) {
      const accent = ensureReadableOnLight(primaryColor);
      root.setProperty("--color-accent", accent);
      root.setProperty("--color-accent-hover", darken(accent, 0.82));
    } else {
      root.removeProperty("--color-accent");
      root.removeProperty("--color-accent-hover");
    }
  }, [enabled, primaryColor]);

  return null;
}
