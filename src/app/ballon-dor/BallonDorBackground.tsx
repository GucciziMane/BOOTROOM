import type { ReactNode } from "react";
import { BallonDorIcon } from "@/app/BallonDorIcon";

/**
 * Habillage propre à cette page : remplace la photo de stade + le blason du club favori (posés
 * globalement par layout.tsx/ThemeApplier.tsx) par un fond sombre à lueur dorée + le ballon en
 * grand filigrane, plutôt que de les tinter par-dessus — demandé explicitement pour que cette page
 * se démarque comme un "événement" à part, pas une variante de plus du thème club.
 *
 * min-h-[100dvh] (pas h-full) : le fond doit couvrir tout l'écran même si le contenu est plus
 * court, mais reste libre de grandir avec lui (liste des 10 places + accordéon ouvert peut dépasser
 * un écran) — même raisonnement que dashboard/page.tsx pour son propre fond.
 */
export function BallonDorBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden" style={{ backgroundColor: "#0e0906" }}>
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(120% 55% at 12% -8%, rgba(232,166,0,0.32), rgba(14,9,6,0) 62%), " +
            "radial-gradient(90% 50% at 100% 105%, rgba(232,166,0,0.14), rgba(14,9,6,0) 60%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
        <BallonDorIcon gradientId="bdor-gold-watermark" className="h-[85vmin] w-[85vmin] max-w-none opacity-[0.07]" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
