"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/calendar", label: "Pronos", emoji: "🎯", isActive: (p: string) => p.startsWith("/calendar") || /^\/leagues\/[^/]+\/calendar/.test(p) },
  { href: "/quiz", label: "Quiz", emoji: "🧠", isActive: (p: string) => p.startsWith("/quiz") },
  { href: "/leaderboard", label: "Mon classement", emoji: "🏅", isActive: (p: string) => p.startsWith("/leaderboard") },
  { href: "/leagues", label: "Prédictions", emoji: "🔮", isActive: (p: string) => p === "/leagues" || /^\/leagues\/[^/]+$/.test(p) },
  { href: "/chat", label: "Chat", emoji: "🍻", isActive: (p: string) => p.startsWith("/chat") },
];

// Pages publiques (avant connexion) : pas de nav vers des sections qui vont rediriger vers /login.
const HIDDEN_PREFIXES = ["/login", "/signup", "/auth"];

export function BottomNav() {
  const pathname = usePathname();
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 pb-4 pt-2 text-xs font-bold ${
                active ? "text-ink" : "text-mute"
              }`}
            >
              <span className="text-2xl">{tab.emoji}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
