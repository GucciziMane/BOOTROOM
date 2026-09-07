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
// ait besoin de recharger la page.
//
// Le back (cron live-tick) s'auto-replanifie toutes les 15s pendant qu'un match est réellement en
// cours (voir route.ts) : un polling client plus lent que ça laisserait une donnée fraîche
// attendre sans raison avant d'être affichée.
const POLL_MS = 10_000;

export function LiveMatchesBanner({ initialMatches }: { initialMatches: LiveMatchDto[] }) {
  const [matches, setMatches] = useState(initialMatches);
  const inFlight = useRef(false);

  useEffect(() => {
    const interval = setInterval(async () => {
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
    }, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  if (matches.length === 0) return null;

  // Un match "finished" reste affiché ici un moment après coup de sifflet final (voir
  // getLiveMatches), mais rien ne doit plus clignoter "en direct" si plus aucun ne l'est vraiment —
  // sans ce garde-fou, le bandeau continuait d'afficher le point rouge pulsant sur des résultats
  // déjà terminés, alors que chaque carte individuelle affichait pourtant bien "Terminé".
  const anyLive = matches.some((m) => m.status === "live");

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-mute">
        {anyLive ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-bad" />
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-line" />
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
