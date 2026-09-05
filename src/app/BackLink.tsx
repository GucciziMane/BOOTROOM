import Link from "next/link";
import type { ReactNode } from "react";

/** Lien "retour" façon app native : chevron + texte plein, pas de soulignement bleu de lien web. */
export function BackLink({ href, children = "Retour" }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-0.5 text-sm font-bold text-mute transition-colors hover:text-ink">
      <span aria-hidden className="text-base leading-none">
        ‹
      </span>
      {children}
    </Link>
  );
}
