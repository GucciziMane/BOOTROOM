"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";

export interface NavCarouselCard {
  href: string;
  emoji: string;
  title: string;
  description: string;
  badgeCount?: number;
}

// Largeur d'une carte en % du conteneur : ~78% laisse ~11% de chaque voisine visible dans le
// fond de part et d'autre (l'effet "3 cartes, celle du milieu entière" demandé), tout en restant
// assez large pour lire confortablement titre + description sur mobile.
const CARD_WIDTH_PCT = 78;
const SIDE_PADDING_PCT = (100 - CARD_WIDTH_PCT) / 2;

// Le dessin visible d'un emoji ne touche pas forcément le haut de sa propre boîte de caractère —
// cet espace vide au-dessus varie d'un emoji à l'autre (mesuré via canvas, pixels non-transparents,
// à 60px — la taille réelle de text-6xl), donc même avec des boîtes CSS identiques et centrées,
// le contenu de chaque carte démarrait visuellement à une hauteur différente selon l'emoji.
// Valeurs relatives à 🏆/🏅 (déjà au ras du haut de leur boîte, donc 0) : les emoji plus "petits"
// dans leur boîte sont remontés d'autant pour aligner leur haut visible sur celui du trophée.
const EMOJI_TOP_OFFSET_PX: Record<string, number> = {
  "🎯": 5,
  "🏆": 0,
  "🏅": 0,
  "🍻": 2.5,
  "🧠": 2,
};

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
          className="relative flex min-h-[340px] shrink-0 snap-center flex-col items-center justify-center rounded-2xl border-2 border-paper/25 bg-surface-inverse/55 p-6 text-center text-paper shadow-lg backdrop-blur-md transition-colors hover:border-paper/50 hover:bg-surface-inverse/65"
          style={{ flex: `0 0 ${CARD_WIDTH_PCT}%`, willChange: "transform, opacity" }}
        >
          {!!c.badgeCount && (
            <span className="absolute right-4 top-4 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-paper">
              {c.badgeCount}
            </span>
          )}
          <span
            className="text-6xl"
            style={{ transform: `translateY(-${EMOJI_TOP_OFFSET_PX[c.emoji] ?? 0}px)` }}
          >
            {c.emoji}
          </span>
          {/* min-h-[72px] (= 2 lignes à text-3xl) : "3ème mi‑temps" passe sur 2 lignes sur une
              carte mobile étroite alors que "Podium" (un seul mot) tient sur 1 — sans hauteur
              fixe ici, ce titre plus haut poussait TOUT le bloc emoji+titre+description vers le
              haut par rapport aux cartes à titre court, exactement le même problème que la
              description ci-dessous, juste pas repéré avant faute d'avoir testé à une largeur de
              carte assez étroite pour que "3ème mi‑temps" bascule sur 2 lignes. */}
          <span className="mt-4 flex min-h-[72px] items-center text-3xl font-bold">{c.title}</span>
          {/* min-h-24 (mesuré : la description la plus longue tient sur 4 lignes à ~256px de
              large, largeur de contenu réaliste d'une carte mobile) : sans ça, le bloc
              emoji+titre+description entier se centre verticalement SELON SA PROPRE hauteur —
              une description plus courte fait remonter l'emoji/titre par rapport aux autres
              cartes (jusqu'à 12px d'écart mesuré), visible au swipe comme un "saut" vertical.
              Une hauteur de description fixe rend le bloc entier identique d'une carte à
              l'autre, donc le centrage aligne emoji/titre au même endroit partout. */}
          <span className="mt-3 flex min-h-24 items-center text-base text-paper/75">{c.description}</span>
        </Link>
      ))}
    </div>
  );
}
