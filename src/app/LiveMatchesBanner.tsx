"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { LiveMatchDto } from "@/lib/live-matches";

// Poll plutôt que Supabase Realtime : le back (cron live-tick) n'écrit de toute façon qu'une
// fois par minute, donc un polling à ce rythme reste largement "en direct" à l'échelle humaine,
// pour une fraction de la complexité (pas de résolution de noms de joueurs à partir d'un payload
// realtime partiel, pas d'auth de canal à hydrater). Se relance même quand la liste est vide,
// pour détecter un match qui démarre sans que l'utilisateur ait besoin de recharger la page.
const POLL_MS = 20_000;

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

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-mute">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-bad" />
        </span>
        En direct
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

  return (
    <div
      className="w-64 shrink-0 rounded-2xl border border-line bg-paper p-3 shadow-sm"
      style={{ borderLeftColor: match.leagueColor, borderLeftWidth: 4 }}
    >
      <div className="mb-2 flex items-center justify-between text-xs font-bold text-mute">
        <span>{match.leagueFlag}</span>
        {match.status === "live" ? (
          <span className="text-bad">{match.liveClock ?? "En cours"}</span>
        ) : (
          <span>Terminé</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <TeamRow name={match.homeTeamName} logoUrl={match.homeLogoUrl} />
        <span className="shrink-0 text-lg font-bold">
          {match.homeScore ?? 0} – {match.awayScore ?? 0}
        </span>
        <TeamRow name={match.awayTeamName} logoUrl={match.awayLogoUrl} reverse />
      </div>

      {match.goals.length > 0 && (
        <div className="mt-2 flex justify-between gap-2 text-[11px] leading-tight text-mute">
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

function TeamRow({ name, logoUrl, reverse }: { name: string; logoUrl: string | null; reverse?: boolean }) {
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${reverse ? "flex-row-reverse text-right" : ""}`}>
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={20} height={20} className="h-5 w-5 shrink-0 object-contain" />
      ) : (
        <span className="block h-5 w-5 shrink-0 rounded-full bg-cream" />
      )}
      <span className="truncate text-xs font-bold">{name}</span>
    </span>
  );
}
