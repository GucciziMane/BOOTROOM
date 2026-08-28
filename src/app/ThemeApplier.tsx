"use client";

import { useEffect } from "react";
import Image from "next/image";
import { darken, ensureReadableOnLight, mixWithWhite } from "@/lib/color";

const ROOT_PROPERTIES = ["--color-accent", "--color-accent-hover", "--color-line"];

/** Applique (ou retire) la teinte du club favori : dégradé des deux couleurs du club en fond de
 * page, bordures teintées, boutons dans la couleur principale — pas qu'un simple accent, sinon
 * le changement passe inaperçu pour un club dont l'identité est justement bicolore. */
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
      root.setProperty("--color-accent", accent);
      root.setProperty("--color-accent-hover", darken(accent, 0.82));
      root.setProperty("--color-line", mixWithWhite(primaryColor, 0.68));

      const secondary = secondaryColor ?? primaryColor;
      document.body.style.background = `linear-gradient(160deg, ${mixWithWhite(primaryColor, 0.86)}, ${mixWithWhite(secondary, 0.82)})`;
      document.body.style.backgroundAttachment = "fixed";
    } else {
      for (const prop of ROOT_PROPERTIES) root.removeProperty(prop);
      document.body.style.background = "";
      document.body.style.backgroundAttachment = "";
    }
  }, [enabled, primaryColor, secondaryColor]);

  return null;
}

/** Blason du club en grand filigrane derrière le contenu, fixe, discret. */
export function ClubCrestWatermark({ enabled, crestUrl }: { enabled: boolean; crestUrl: string | null }) {
  if (!enabled || !crestUrl) return null;
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center overflow-hidden">
      <Image
        src={crestUrl}
        alt=""
        width={520}
        height={520}
        className="h-[70vmin] w-[70vmin] max-w-none object-contain opacity-[0.08]"
      />
    </div>
  );
}
