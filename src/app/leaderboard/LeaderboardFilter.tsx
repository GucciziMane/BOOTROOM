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

// Ligne entière teintée (pas juste un contour d'avatar) pour les 3 premiers du classement affiché
// — recalculé à chaque tri (filtre "Tous" ou un championnat précis), donc toujours le top 3 du
// classement réellement visible à l'écran. Deux couches de fond superposées (cf. `gradient` ci-
// dessous, une string CSS `background` avec virgule) : un reflet net (bande blanche à bords adoucis,
// pas un simple fondu depuis le bord) qui BALAIE la ligne en boucle (voir `.animate-medal-shine`,
// globals.css — désactivé si "réduire les animations") PAR-DESSUS un dégradé métallique à plusieurs
// paliers (clair/sombre alternés, pas juste 2 teintes) — c'est cette alternance + le passage du
// reflet qui lit comme "brillant/poli" plutôt qu'un aplat de couleur statique. Couleurs choisies
// pour lire sans ambiguïté comme or/argent/bronze (pas cuivre : plus brun, moins orangé).
// Texte en encre sombre fixe (pas les tokens ink/mute réactifs au thème) car ce fond clair reste le
// même quel que soit le thème, comme pour les boutons de réponse du quiz (cf. QuizRunner.tsx) — le
// même piège blanc-sur-blanc s'appliquerait sinon.
const MEDAL_ROW: Record<number, { gradient: string; border: string; text: string; textSoft: string; emoji: string; glow: string }> = {
  0: {
    gradient:
      "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 45%, rgba(255,255,255,0) 62%), " +
      "linear-gradient(120deg, #fff6c8 0%, #ffd23f 16%, #e8a600 32%, #fff0a0 46%, #c9880a 62%, #a56a05 78%, #ffe066 90%, #8a6205 100%)",
    border: "#ffe27a",
    text: "#3a2705",
    textSoft: "#5c4110",
    emoji: "🥇",
    glow: "0 0 28px rgba(255, 196, 20, 0.55)",
  },
  1: {
    gradient:
      "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 45%, rgba(255,255,255,0) 62%), " +
      "linear-gradient(120deg, #ffffff 0%, #e4e9ee 16%, #c3ccd4 32%, #ffffff 46%, #a8b1ba 62%, #838d97 78%, #eef1f4 90%, #626b74 100%)",
    border: "#f5f7f9",
    text: "#20262c",
    textSoft: "#454e58",
    emoji: "🥈",
    glow: "0 0 24px rgba(200, 210, 220, 0.55)",
  },
  2: {
    gradient:
      "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 45%, rgba(255,255,255,0) 62%), " +
      "linear-gradient(120deg, #eecba3 0%, #cd7f32 16%, #9c5a22 32%, #ecc190 46%, #7a4a20 62%, #5c3717 78%, #d69a5c 90%, #4a2b12 100%)",
    border: "#e6b57e",
    text: "#301c09",
    textSoft: "#54331a",
    emoji: "🥉",
    glow: "0 0 24px rgba(205, 127, 50, 0.5)",
  },
};

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
          const medal = MEDAL_ROW[i];
          return (
            <li key={p.id}>
              <Link
                href={`/leaderboard/${p.id}`}
                transitionTypes={["nav-forward"]}
                // Toute la liste est visible sans scroll (petit groupe d'amis) : sans ça, le profil
                // de chaque joueur précharge en arrière-plan dès l'affichage de cette page.
                prefetch={false}
                className={`relative flex items-center gap-3 p-4 transition-[filter,background-color] ${
                  medal ? "animate-medal-shine hover:brightness-110" : "hover:bg-cream"
                }`}
                style={
                  medal
                    ? {
                        background: medal.gradient,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "-60% 0, 0 0",
                        boxShadow: `inset ${medal.glow}`,
                      }
                    : undefined
                }
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`w-6 shrink-0 text-center ${medal ? "text-2xl leading-none" : "text-mute"}`}
                    aria-hidden={!!medal}
                  >
                    {medal ? medal.emoji : i + 1}
                  </span>
                  {medal && <span className="sr-only">{i + 1}e place —</span>}
                  <span className="relative h-12 w-12 shrink-0">
                    <span
                      className={`relative block h-12 w-12 overflow-hidden rounded-full bg-surface ${
                        medal ? "border-[3px]" : "border-2 border-line"
                      }`}
                      style={medal ? { borderColor: medal.border } : undefined}
                    >
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
                  <span className="truncate font-bold" style={medal ? { color: medal.text } : undefined}>
                    {p.username}
                  </span>
                </span>
                <span className="w-9 shrink-0 text-right font-bold" style={medal ? { color: medal.text } : undefined}>
                  {stat.good}
                </span>
                <span className="w-9 shrink-0 text-right font-bold" style={medal ? { color: medal.text } : undefined}>
                  {stat.exact}
                </span>
                <span className="w-14 shrink-0 text-right font-bold" style={medal ? { color: medal.text } : undefined}>
                  {stat.points}
                </span>
                <span
                  aria-hidden
                  className={`w-3 shrink-0 text-right ${medal ? "" : "text-mute"}`}
                  style={medal ? { color: medal.textSoft } : undefined}
                >
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
        active ? "bg-accent text-white shadow-sm" : "border border-line bg-surface text-mute hover:border-accent hover:text-accent"
      }`}
    >
      {label}
    </button>
  );
}
