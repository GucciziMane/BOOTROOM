"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { listCard } from "@/lib/ui";
import { FavoriteTeamBadge } from "@/app/profile/FavoriteTeamBadge";

interface LeagueStat {
  points: number;
  good: number;
  exact: number;
}

export interface LeaderboardRow {
  id: string;
  username: string;
  avatarUrl: string | null;
  favoriteTeamLogoUrl: string | null;
  total: number;
  good: number;
  exact: number;
  byLeague: Record<number, LeagueStat>;
}

interface LeagueOption {
  id: number;
  name: string;
  flag: string;
}

/** "Tous" (agrégat multi-championnats) ou un championnat précis — bascule entre les deux
 * uniquement en mémoire (les données de chaque championnat sont déjà toutes chargées côté
 * serveur), pas de rechargement de page au clic. */
export function LeaderboardFilter({ rows, leagues }: { rows: LeaderboardRow[]; leagues: LeagueOption[] }) {
  const [selected, setSelected] = useState<number | "all">("all");

  const sorted = useMemo(() => {
    if (selected === "all") return [...rows].sort((a, b) => b.total - a.total);
    return [...rows]
      .map((r) => ({ ...r, stat: r.byLeague[selected] ?? { points: 0, good: 0, exact: 0 } }))
      .sort((a, b) => b.stat.points - a.stat.points);
  }, [rows, selected]);

  return (
    <div>
      {/* Bord à bord (-mx-6, compensé par px-6) : les puces débordent visuellement jusqu'au bord de
          l'écran comme une barre de filtre d'appli native, tout en restant dans un conteneur qui
          scrolle horizontalement pour lui seul (jamais toute la page) si elles ne tiennent pas. */}
      <div className="no-scrollbar -mx-6 mb-4 flex gap-2 overflow-x-auto px-6 pb-1">
        <FilterChip label="🏆 Tous" active={selected === "all"} onClick={() => setSelected("all")} />
        {leagues.map((l) => (
          <FilterChip
            key={l.id}
            label={`${l.flag} ${l.name}`}
            active={selected === l.id}
            onClick={() => setSelected(l.id)}
          />
        ))}
      </div>

      <div className="mb-2 flex items-center gap-3 px-4 text-right text-[11px] font-bold uppercase tracking-wide text-mute">
        <span className="flex-1 text-left">Joueur</span>
        <span className="w-9">Bons</span>
        <span className="w-9">Exacts</span>
        <span className="w-14">Points</span>
        <span className="w-3" aria-hidden />
      </div>
      <ul className={`mb-8 ${listCard}`}>
        {sorted.map((p, i) => {
          const stat = selected === "all" ? { points: p.total, good: p.good, exact: p.exact } : p.byLeague[selected];
          return (
            <li key={p.id}>
              <Link
                href={`/leaderboard/${p.id}`}
                transitionTypes={["nav-forward"]}
                // Toute la liste est visible sans scroll (petit groupe d'amis) : sans ça, le profil
                // de chaque joueur précharge en arrière-plan dès l'affichage de cette page.
                prefetch={false}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-cream"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-5 shrink-0 text-mute">{i + 1}</span>
                  <span className="relative h-12 w-12 shrink-0">
                    <span className="relative block h-12 w-12 overflow-hidden rounded-full border-2 border-line bg-cream">
                      {p.avatarUrl ? (
                        <Image src={p.avatarUrl} alt="" fill sizes="48px" className="object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-lg font-bold text-mute">
                          {p.username.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <FavoriteTeamBadge logoUrl={p.favoriteTeamLogoUrl} size={18} />
                  </span>
                  <span className="truncate font-bold">{p.username}</span>
                </span>
                <span className="w-9 shrink-0 text-right font-bold">{stat.good}</span>
                <span className="w-9 shrink-0 text-right font-bold">{stat.exact}</span>
                <span className="w-14 shrink-0 text-right font-bold">{stat.points}</span>
                <span aria-hidden className="w-3 shrink-0 text-right text-mute">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
        {sorted.length === 0 && <li className="p-4 text-mute">Personne n&apos;a encore de points.</li>}
      </ul>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors ${
        active ? "bg-accent text-white shadow-sm" : "border border-line bg-paper text-mute hover:border-accent hover:text-accent"
      }`}
    >
      {label}
    </button>
  );
}
