"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, MessageCircle, Trophy, User } from "lucide-react";
import { memo } from "react";

const navItems = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/calendar", label: "Calendrier", icon: Calendar },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/leaderboard", label: "Classement", icon: Trophy },
  { href: "/profile", label: "Profil", icon: User },
] as const;

export const BottomNav = memo(function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border safe-bottom" role="navigation" aria-label="Navigation principale">
      <div className="grid h-16 grid-cols-5 items-center">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`group flex flex-col items-center justify-center gap-1 transition-all duration-200 active:scale-95 ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} aria-current={isActive ? "page" : undefined}>
              <Icon className="h-5 w-5 transition-transform group-active:scale-90" strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
});

BottomNav.displayName = "BottomNav";
