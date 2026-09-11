"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { LiveMatchDto } from "@/lib/live-matches";
import {
  getLeagueCardStyle,
  leagueCardTeamTextClass,
  leagueCardTeamPlaceholderClass,
  LeagueCardBackground,
} from "@/lib/league-card-theme";
import { LEAGUE_BACKGROUND } from "@/lib/league-background";

// Poll plutôt que Supabase Realtime : pour une fraction de la complexité (pas de résolution de
// noms de joueurs à partir d'un payload realtime partiel, pas d'auth de canal à hydrater). Se
// relance même quand la liste est vide, pour détecter un match qui démarre sans que l'utilisateur
// ait besoin de recharger la page. Complété par un refetch immédiat sur `visibilitychange`/`focus`
// (voir plus bas) — indispensable sur mobile, où l'intervalle seul reste suspendu tant que l'onglet
// est en arrière-plan.
//
// Le back (cron live-tick) s'auto-replanifie toutes les 15s pendant qu'un match est réellement en
// cours (voir route.ts) : un polling client plus lent que ça laisserait une donnée fraîche
// attendre sans raison avant d'être affichée.
const POLL_MS = 10_000;

export function LiveMatchesBanner({
  initialMatches,
  variant = "light",
}: {
  initialMatches: LiveMatchDto[];
  /** "dark" : libellé/puce éclaircis pour rester lisibles sur un fond sombre (photo, etc.) — les
   * cartes de match gardent leur propre habillage par championnat, inchangé dans les deux cas. */
  variant?: "light" | "dark";
}) {
  const [matches, setMatches] = useState(initialMatches);
  const inFlight = useRef(false);

  useEffect(() => {
    async function poll() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/live-matches", { cache: "no-store" });
        if (res.ok) {
          const { matches: fresh } = (await res.json()) as { matches: LiveMatchDto[] };
          setMatches(fresh);
        }
      } catch {
        // Prochain tick réessaiera ; pas la peine de faire échouer l'affichage pour un poll raté.
      } finally {
        inFlight.current = false;
      }
    }

    const interval = setInterval(poll, POLL_MS);

    // setInterval seul ne suffit pas sur mobile : un onglet en arrière-plan (écran verrouillé,
    // appli changée) voit ses timers suspendus par l'OS/le navigateur — à la réouverture, le
    // premier tick peut mettre jusqu'à POLL_MS à arriver, avec un score/temps de jeu resté figé
    // entre-temps (symptôme observé : "ça ne se met à jour qu'après un refresh manuel"). Un
    // rafraîchissement immédiat dès que l'onglet redevient visible/repasse au premier plan évite
    // cette attente, sans jamais avoir besoin d'un vrai rechargement de page.
    function handleVisible() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", poll);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", poll);
    };
  }, []);

  if (matches.length === 0) return null;

  // Un match "finished" reste affiché ici un moment après coup de sifflet final (voir
  // getLiveMatches), mais rien ne doit plus clignoter "en direct" si plus aucun ne l'est vraiment —
  // sans ce garde-fou, le bandeau continuait d'afficher le point rouge pulsant sur des résultats
  // déjà terminés, alors que chaque carte individuelle affichait pourtant bien "Terminé".
  const anyLive = matches.some((m) => m.status === "live");

  return (
    <div className="mb-5">
      <div className={`mb-2 flex items-center gap-1.5 text-sm font-bold ${variant === "dark" ? "text-paper/80" : "text-mute"}`}>
        {anyLive ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-bad" />
          </span>
        ) : (
          <span className={`h-2 w-2 rounded-full ${variant === "dark" ? "bg-paper/40" : "bg-line"}`} />
        )}
        {anyLive ? "En direct" : "Résultats récents"}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {matches.map((m) => (
          <LiveMatchCard key={m.id} match={m} />
        ))}
      </div>
    </div>
  );
}

function LiveMatchCard({ match }: { match: LiveMatchDto }) {
  const homeGoals = match.goals.filter((g) => g.teamSide === "home");
  const awayGoals = match.goals.filter((g) => g.teamSide === "away");
  const background = LEAGUE_BACKGROUND[match.leagueCode];
  const { theme, cardClassName, cardStyle, textFaint, textStrong } = getLeagueCardStyle(match.leagueCode, match.leagueColor, "p-3");

  return (
    <div className={`w-64 shrink-0 ${cardClassName}`} style={cardStyle}>
      {background && <LeagueCardBackground image={background.image} light={theme === "light"} />}
      <div className={`relative mb-2 flex items-center justify-between text-xs font-bold ${textFaint}`}>
        <span>{match.leagueFlag}</span>
        {match.status === "live" ? (
          <span className="text-bad">{match.liveClock ?? "En cours"}</span>
        ) : (
          <span>Terminé</span>
        )}
      </div>

      <div className="relative flex items-center justify-between gap-2">
        <TeamRow name={match.homeTeamName} logoUrl={match.homeLogoUrl} theme={theme} />
        <span className={`shrink-0 text-lg font-bold ${textStrong}`}>
          {match.homeScore ?? 0} – {match.awayScore ?? 0}
        </span>
        <TeamRow name={match.awayTeamName} logoUrl={match.awayLogoUrl} theme={theme} reverse />
      </div>

      {match.goals.length > 0 && (
        <div className={`relative mt-2 flex justify-between gap-2 text-[11px] leading-tight ${textFaint}`}>
          <div>
            {homeGoals.map((g, i) => (
              <div key={i}>
                ⚽ {g.scorerName}
                {g.minute != null ? ` ${g.minute}'` : ""}
              </div>
            ))}
          </div>
          <div className="text-right">
            {awayGoals.map((g, i) => (
              <div key={i}>
                ⚽ {g.scorerName}
                {g.minute != null ? ` ${g.minute}'` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamRow({
  name,
  logoUrl,
  theme,
  reverse,
}: {
  name: string;
  logoUrl: string | null;
  theme: "none" | "dark" | "light";
  reverse?: boolean;
}) {
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${reverse ? "flex-row-reverse text-right" : ""}`}>
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={20} height={20} className="h-5 w-5 shrink-0 object-contain" />
      ) : (
        <span className={`block h-5 w-5 shrink-0 rounded-full ${leagueCardTeamPlaceholderClass(theme)}`} />
      )}
      <span className={`truncate text-xs font-bold ${leagueCardTeamTextClass(theme)}`}>{name}</span>
    </span>
  );
}
