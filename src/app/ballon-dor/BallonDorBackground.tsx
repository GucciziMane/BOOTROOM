import type { ReactNode } from "react";
import { BallonDorIcon } from "@/app/BallonDorIcon";

/**
 * Habillage propre à cette page : remplace la photo de stade + le blason du club favori (posés
 * globalement par layout.tsx/ThemeApplier.tsx) par un fond sombre à lueur dorée + le ballon en
 * grand filigrane, plutôt que de les tinter par-dessus — demandé explicitement pour que cette page
 * se démarque comme un "événement" à part, pas une variante de plus du thème club.
 *
 * fixed inset-0 (comme StadiumBackdrop, pas un div en flux normal) : <body> (layout.tsx) réserve
 * un padding-top pour la safe-area (encoche/barre de statut iOS) — un fond en flux normal démarre
 * SOUS ce padding, laissant apparaître le fond clair de <body> juste derrière l'heure/la batterie
 * (vu en prod : bande blanchâtre en haut d'écran). "fixed" ignore ce padding et couvre tout le
 * viewport, contenu compris. Toujours sous le contenu réel : cette page reste dans le wrapper
 * "relative z-10" global (layout.tsx) au-dessus de la photo de stade elle-même en z-0.
 */
export function BallonDorBackground({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-0" style={{ backgroundColor: "#0e0906" }} aria-hidden />
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(120% 55% at 12% -8%, rgba(232,166,0,0.32), rgba(14,9,6,0) 62%), " +
            "radial-gradient(90% 50% at 100% 105%, rgba(232,166,0,0.14), rgba(14,9,6,0) 60%)",
        }}
      />
      <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden" aria-hidden>
        <BallonDorIcon gradientId="bdor-gold-watermark" className="h-[85vmin] w-[85vmin] max-w-none opacity-[0.07]" />
      </div>
      <div className="relative z-10">{children}</div>
    </>
  );
}
