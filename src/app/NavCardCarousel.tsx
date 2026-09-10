"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";

export interface NavCarouselCard {
  href: string;
  title: string;
  description: string;
  badgeCount?: number;
}

// Largeur d'une carte en % du conteneur : ~78% laisse ~11% de chaque voisine visible dans le
// fond de part et d'autre (l'effet "3 cartes, celle du milieu entière" demandé), tout en restant
// assez large pour lire confortablement titre + description sur mobile.
const CARD_WIDTH_PCT = 78;
const SIDE_PADDING_PCT = (100 - CARD_WIDTH_PCT) / 2;

/**
 * Carrousel de cartes qui tourne à l'infini : le scroll horizontal natif (scroll-snap) gère le
 * swipe/drag/momentum sans réinventer la physique du geste, sur 3 copies bout à bout de la liste —
 * dès que le scroll s'approche du bord de la 1ère ou de la 3ᵉ copie, on saute silencieusement
 * (sans animation, donc invisible) à la position équivalente dans la copie du milieu, ce qui donne
 * l'illusion d'un tour sans fin dans les deux sens. La carte centrée reste pleine taille/opacité,
 * les voisines se réduisent et s'estompent en fonction de leur distance au centre (recalculé à
 * chaque frame de scroll via rAF, throttlé).
 */
export function NavCardCarousel({ cards }: { cards: NavCarouselCard[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const rafId = useRef<number | null>(null);
  const setWidthRef = useRef(0);

  const repeated = [...cards, ...cards, ...cards];

  const applyFalloff = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    for (const el of cardRefs.current) {
      if (!el) continue;
      const cardCenter = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(cardCenter - center) / scroller.clientWidth;
      // 0 au centre -> 1 pleinement écarté : clamp à 1 pour que les cartes hors des 3 visibles
      // (copies plus loin dans le DOM) n'aillent pas sous une échelle/opacité ridicule.
      const t = Math.min(dist * 1.6, 1);
      el.style.transform = `scale(${1 - 0.16 * t})`;
      el.style.opacity = `${1 - 0.55 * t}`;
    }
  }, []);

  // Centre une carte par calcul direct (son centre = le centre du viewport) : avec
  // scroll-snap-type actif, un simple `scrollLeft = ...` se fait re-corriger par le navigateur
  // vers SA propre valeur de snap dès le prochain scroll (observé ~24px à côté du centre réel,
  // visible comme une carte voisine qui dépasse plus d'un côté que de l'autre) — couper le snap
  // le temps de poser la valeur, puis le rétablir juste après, fait que notre valeur devient elle-
  // même la position "installée" plutôt que d'être aussitôt corrigée.
  const centerOn = useCallback((el: HTMLElement) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.style.scrollSnapType = "none";
    scroller.scrollLeft = el.offsetLeft + el.offsetWidth / 2 - scroller.clientWidth / 2;
    // Sur la frame suivante : le navigateur a eu le temps d'appliquer scrollLeft avant que le
    // snap ne redevienne actif, donc rien à re-corriger au prochain scroll de l'utilisateur.
    requestAnimationFrame(() => {
      if (scrollerRef.current) scrollerRef.current.style.scrollSnapType = "";
    });
  }, []);

  const handleScroll = useCallback(() => {
    if (rafId.current != null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      applyFalloff();

      // Ressaut invisible dès qu'on dérive dans la 1ère ou la 3ᵉ copie : on retombe sur la même
      // carte visuellement, exactement un jeu plus loin/moins loin, sans transition (scrollLeft
      // posé directement) donc rien ne se voit à l'écran.
      const setWidth = setWidthRef.current;
      if (setWidth <= 0) return;
      if (scroller.scrollLeft < setWidth * 0.5) {
        scroller.style.scrollSnapType = "none";
        scroller.scrollLeft += setWidth;
        requestAnimationFrame(() => {
          if (scrollerRef.current) scrollerRef.current.style.scrollSnapType = "";
        });
      } else if (scroller.scrollLeft > setWidth * 1.5) {
        scroller.style.scrollSnapType = "none";
        scroller.scrollLeft -= setWidth;
        requestAnimationFrame(() => {
          if (scrollerRef.current) scrollerRef.current.style.scrollSnapType = "";
        });
      }
    });
  }, [applyFalloff]);

  useEffect(() => {
    const firstOfSet1 = cardRefs.current[0];
    const firstOfSet2 = cardRefs.current[cards.length];
    if (!firstOfSet1 || !firstOfSet2) return;
    // scrollWidth / 3 n'est PAS exactement "un jeu de cartes" : le padding-inline du conteneur
    // (en %, donc lui-même dépendant de sa propre largeur) fausse ce calcul approximatif. La
    // distance RÉELLE entre le même repère (le début de chaque jeu) dans deux copies consécutives
    // se mesure directement sur les éléments déjà rendus, sans hypothèse sur les %/paddings.
    setWidthRef.current = firstOfSet2.offsetLeft - firstOfSet1.offsetLeft;
    centerOn(firstOfSet2);
    applyFalloff();
  }, [applyFalloff, centerOn, cards.length]);

  useEffect(() => {
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="no-scrollbar flex w-full snap-x snap-mandatory gap-4 overflow-x-auto"
      style={{ paddingInline: `${SIDE_PADDING_PCT}%` }}
    >
      {repeated.map((c, i) => (
        <Link
          key={i}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
          href={c.href}
          prefetch={false}
          className="relative flex min-h-[220px] shrink-0 snap-center flex-col items-center justify-center rounded-2xl border-2 border-line bg-paper p-6 text-center shadow-sm transition-colors hover:border-ink hover:bg-cream"
          style={{ flex: `0 0 ${CARD_WIDTH_PCT}%`, willChange: "transform, opacity" }}
        >
          {!!c.badgeCount && (
            <span className="absolute right-4 top-4 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-paper">
              {c.badgeCount}
            </span>
          )}
          <span className="text-3xl font-bold">{c.title}</span>
          <span className="mt-3 text-base text-mute">{c.description}</span>
        </Link>
      ))}
    </div>
  );
}
