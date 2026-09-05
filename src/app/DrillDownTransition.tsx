import { ViewTransition } from "react";

const DIRECTIONAL = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

/**
 * À réexporter tel quel comme `template.tsx` dans une section "liste -> détail" (voir
 * src/app/globals.css pour les classes .nav-forward/.nav-back). `default="none"` : ce template ne
 * doit réagir qu'aux navigations explicitement taguées (via <Link transitionTypes>), jamais aux
 * mises à jour normales de la page ni interférer avec le fondu du template racine.
 */
export default function DrillDownTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none">
      {children}
    </ViewTransition>
  );
}
