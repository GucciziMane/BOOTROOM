"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Types de <input> qui ouvrent un vrai clavier virtuel sur mobile — pas checkbox/radio/file/range/
// color/submit/button, dont le focus ne déclenche jamais de clavier.
const TEXTUAL_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "password", "number"]);

function isTextEntryElement(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXTUAL_INPUT_TYPES.has(el.type);
  return false;
}

const TABS = [
  { href: "/calendar", label: "Pronos", emoji: "🎯", isActive: (p: string) => p.startsWith("/calendar") || /^\/leagues\/[^/]+\/calendar/.test(p) },
  { href: "/quiz", label: "Quiz", emoji: "🧠", isActive: (p: string) => p.startsWith("/quiz") },
  { href: "/leaderboard", label: "Podium", emoji: "🏅", isActive: (p: string) => p.startsWith("/leaderboard") },
  { href: "/chat", label: "Chat", emoji: "🍻", isActive: (p: string) => p.startsWith("/chat") },
];

// Pages publiques (avant connexion) : pas de nav vers des sections qui vont rediriger vers /login.
const HIDDEN_PREFIXES = ["/login", "/signup", "/auth"];
// Dashboard (/) : masquée à la demande de l'utilisateur — le carrousel de navigation en bas de
// page fait déjà double emploi avec cette barre. Code conservé (pas supprimé), simple exclusion
// de route pour pouvoir la remontrer facilement si besoin.
const HIDDEN_EXACT = ["/"];

export function BottomNav() {
  const pathname = usePathname();
  // Masquée pendant la saisie (clavier ouvert) : sur mobile, cette barre fixed se retrouve sinon
  // coincée entre le champ de texte et le clavier virtuel (cf. le chat, où on veut voir un
  // maximum de messages en tapant) — un plein écran de conversation + clavier, sans bande de nav
  // redondante entre les deux, comme dans une vraie appli de messagerie.
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    function handleFocusIn(e: FocusEvent) {
      if (isTextEntryElement(e.target)) setKeyboardOpen(true);
    }
    function handleFocusOut(e: FocusEvent) {
      if (isTextEntryElement(e.target)) setKeyboardOpen(false);
    }
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) || HIDDEN_EXACT.includes(pathname)) return null;

  return (
    <nav
      style={{ viewTransitionName: "bottom-nav" }}
      aria-hidden={keyboardOpen}
      // transform-gpu (translateZ(0)) : sans sa propre couche de composition, cette barre fixed
      // reste peinte avec le reste du document sur certains WebKit mobiles — un scroll rapide la
      // fait alors "traîner"/se figer un instant avant de rattraper la bonne position, au lieu de
      // rester pleinement collée au bas de l'écran comme une barre native. translate-y-full (pas
      // un unmount conditionnel) + transition-transform : la barre glisse hors champ proprement au
      // lieu de disparaître d'un coup sec, et redevient immédiatement disponible si le clavier se
      // referme sans navigation entre-temps.
      className={`fixed inset-x-0 bottom-0 z-20 transform-gpu border-t-2 border-paper/25 bg-surface-inverse/55 pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-transform duration-200 ease-out lg:hidden ${
        keyboardOpen ? "pointer-events-none translate-y-full" : ""
      }`}
    >
      {/* Sans viewTransitionName + les 3 règles CSS "bottom-nav" ci-dessous (globals.css), le
          crossfade racine (::view-transition-old/new(root), 180ms) inclut cette nav fixe dans son
          screenshot pleine page à chaque navigation — un screenshot pris pendant ces 180ms capture
          alors l'ancienne ET la nouvelle page superposées (nav "dédoublée" au milieu du contenu). */}
      <div className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              // Cette barre est montée sur TOUTE page (voir layout.tsx) : avec le préchargement par
              // défaut de <Link>, ces 4 onglets — chacun une page dynamique à plusieurs
              // allers-retours Supabase — se rechargeraient en arrière-plan à CHAQUE navigation,
              // en concurrence avec les requêtes de la page réellement affichée. Pas de
              // préchargement ici, seulement au clic (voir aussi CalendarTabs, même raisonnement).
              prefetch={false}
              className={`flex flex-1 flex-col items-center gap-1 pb-4 pt-2 text-[11px] font-bold ${
                active ? "text-paper" : "text-paper/55"
              }`}
            >
              <span className="text-2xl">{tab.emoji}</span>
              <span className="whitespace-nowrap">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
