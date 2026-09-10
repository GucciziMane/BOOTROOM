// Blocs réutilisables pour les loading.tsx de chaque section. Sans ça, une navigation vers une
// page qui fait plusieurs allers-retours Supabase reste figée sur l'ancien écran jusqu'à ce que
// TOUT ait résolu (aucun Suspense/streaming dans l'app) — malgré tout le travail de transition
// (template.tsx, DrillDownTransition), la navigation elle-même donnait l'impression de bloquer.
// Un loading.tsx affiche ce squelette instantanément (Next l'enveloppe automatiquement dans un
// <Suspense>), le contenu réel le remplaçant dès qu'il arrive — voir le pattern "Suspense reveals"
// de node_modules/next/dist/docs/01-app/02-guides/view-transitions.md.

function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-cream ${className}`} />;
}

/** Mimique une carte de match (voir MatchPredictionCard) : date, deux équipes + score, deux menus,
 * un bouton. Même fond blanc/bordure que le vrai composant pour qu'il n'y ait pas de saut visuel
 * quand le contenu réel apparaît par-dessus. */
export function SkeletonMatchCard() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <Pulse className="h-3 w-24" />
        <Pulse className="h-3 w-16" />
      </div>
      <div className="flex items-center justify-center gap-2">
        <div className="flex w-20 flex-col items-center gap-1.5">
          <Pulse className="h-10 w-10 rounded-full" />
          <Pulse className="h-2.5 w-14" />
        </div>
        <Pulse className="h-9 w-12" />
        <Pulse className="h-4 w-2" />
        <Pulse className="h-9 w-12" />
        <div className="flex w-20 flex-col items-center gap-1.5">
          <Pulse className="h-10 w-10 rounded-full" />
          <Pulse className="h-2.5 w-14" />
        </div>
      </div>
      <Pulse className="mt-3 h-9 w-full" />
      <Pulse className="mt-2 h-9 w-full" />
      <Pulse className="mt-2 h-8 w-full" />
    </div>
  );
}

/** Grille de cartes de match — même disposition que /calendar et /leagues/[code]/calendar
 * (grid-cols-1 sm:grid-cols-2). */
export function SkeletonMatchCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonMatchCard key={i} />
      ))}
    </div>
  );
}

/** Une ligne de liste (voir `listCard` dans ui.ts) : avatar/logo rond + une ou deux lignes de texte. */
export function SkeletonListRow({ avatar = true }: { avatar?: boolean }) {
  return (
    <li className="flex items-center gap-3 p-4">
      {avatar && <Pulse className="h-8 w-8 shrink-0 rounded-full" />}
      <div className="min-w-0 flex-1 space-y-1.5">
        <Pulse className="h-3.5 w-2/5" />
        <Pulse className="h-2.5 w-1/4" />
      </div>
    </li>
  );
}

/** Liste complète, dans un conteneur `listCard` pour rester identique au rendu final. */
export function SkeletonList({ count = 6, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListRow key={i} avatar={avatar} />
      ))}
    </ul>
  );
}

/** Titre de page dont le contenu dépend des données (ex: nom d'un championnat) — la structure
 * (h1 text-3xl font-bold) est connue à l'avance, pas le texte, donc on ne peut pas l'afficher tel
 * quel dans loading.tsx. */
export function SkeletonTitle({ width = "w-48" }: { width?: string }) {
  return <Pulse className={`h-8 ${width}`} />;
}

/** Bloc de texte générique (paragraphe, résumé de section...). */
export function SkeletonText({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Pulse key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
