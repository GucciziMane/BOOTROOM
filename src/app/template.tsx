import { ViewTransition } from "react";

// Un template (contrairement à layout.tsx) est remonté à chaque navigation, ce qui est justement
// ce que demande React pour déclencher une <ViewTransition> automatiquement — voir
// node_modules/next/dist/docs/01-app/02-guides/view-transitions.md. Au premier niveau de l'arbo
// (ici), la clé ne change que quand le PREMIER segment change, donc ça couvre exactement les
// passages d'un onglet de la barre du bas à un autre (Pronos/Quiz/Classement/Prédictions/Chat),
// sans se déclencher pour une navigation interne à un onglet (ex: /calendar -> /calendar/mes-pronos).
export default function RootTemplate({ children }: { children: React.ReactNode }) {
  return <ViewTransition>{children}</ViewTransition>;
}
