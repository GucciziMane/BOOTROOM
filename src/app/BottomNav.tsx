"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/calendar", label: "Pronos", emoji: "🎯", isActive: (p: string) => p.startsWith("/calendar") || /^\/leagues\/[^/]+\/calendar/.test(p) },
  { href: "/quiz", label: "Quiz", emoji: "🧠", isActive: (p: string) => p.startsWith("/quiz") },
  { href: "/leaderboard", label: "Classement", emoji: "🏅", isActive: (p: string) => p.startsWith("/leaderboard") },
  { href: "/chat", label: "Chat", emoji: "🍻", isActive: (p: string) => p.startsWith("/chat") },
];

// Pages publiques (avant connexion) : pas de nav vers des sections qui vont rediriger vers /login.
const HIDDEN_PREFIXES = ["/login", "/signup", "/auth"];

export function BottomNav() {
  const pathname = usePathname();
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      style={{ viewTransitionName: "bottom-nav" }}
      // transform-gpu (translateZ(0)) : sans sa propre couche de composition, cette barre fixed
      // reste peinte avec le reste du document sur certains WebKit mobiles — un scroll rapide la
      // fait alors "traîner"/se figer un instant avant de rattraper la bonne position, au lieu de
      // rester pleinement collée au bas de l'écran comme une barre native.
      className="fixed inset-x-0 bottom-0 z-20 transform-gpu border-t-2 border-paper/25 bg-ink/55 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
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
