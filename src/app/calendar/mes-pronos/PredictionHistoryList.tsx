import Image from "next/image";
import { formatParisDateTime } from "@/lib/format-date";
import { LEAGUE_FLAG, LEAGUE_COLOR } from "@/lib/country-flags";
import { LEAGUE_BACKGROUND } from "@/lib/league-background";
import {
  getLeagueCardStyle,
  leagueCardTeamTextClass,
  leagueCardTeamPlaceholderClass,
  LeagueCardBackground,
} from "@/lib/league-card-theme";
import type { PredictionHistoryRow } from "@/lib/predictions";

export function PredictionHistoryList({ rows }: { rows: PredictionHistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-mute">Aucun pronostic pour l&apos;instant.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => {
        const background = LEAGUE_BACKGROUND[r.leagueCode];
        const { theme, cardClassName, cardStyle, textFaint, textStrong } = getLeagueCardStyle(
          r.leagueCode,
          LEAGUE_COLOR[r.leagueCode]
        );

        return (
          <div key={r.matchId} className={cardClassName} style={cardStyle}>
            {background && <LeagueCardBackground image={background.image} light={theme === "light"} />}
            <p className={`relative mb-2 flex items-center justify-between text-xs font-bold ${textFaint}`}>
              <span>{formatParisDateTime(r.kickoffAt)}</span>
              <span>
                {LEAGUE_FLAG[r.leagueCode] ?? ""} {r.leagueName}
                {r.matchday != null ? ` · J${r.matchday}` : ""}
              </span>
            </p>

            <div className="relative flex items-center justify-center gap-4">
              <TeamBadge name={r.homeName} logoUrl={r.homeLogoUrl} theme={theme} />

              <div className="flex flex-col items-center gap-1">
                <span className={`text-lg font-bold ${textStrong}`}>
                  {r.predictedHome} – {r.predictedAway}
                </span>
                <span className={`text-[11px] font-bold uppercase tracking-wide ${textFaint}`}>Pronostic</span>
                {r.isFinished ? (
                  <>
                    <span className={`mt-1 text-lg font-bold ${textStrong}`}>
                      {r.realHome} – {r.realAway}
                    </span>
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${textFaint}`}>Score réel</span>
                  </>
                ) : (
                  <span className={`mt-1 text-xs font-bold ${textFaint}`}>
                    {r.realHome != null && r.realAway != null ? `En cours : ${r.realHome}-${r.realAway}` : "À venir"}
                  </span>
                )}
              </div>

              <TeamBadge name={r.awayName} logoUrl={r.awayLogoUrl} theme={theme} />
            </div>

            <div className={`relative mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs ${textFaint}`}>
              {r.scorerName && (
                <span>
                  Buteur : {r.scorerName} <ValidityTag valid={r.scorerValid} points={r.scorerPoints} />
                </span>
              )}
              {r.assistName && (
                <span>
                  Passeur : {r.assistName} <ValidityTag valid={r.assistValid} points={r.assistPoints} />
                </span>
              )}
            </div>

            <p className="relative mt-3 text-center text-sm font-bold">
              {r.isFinished ? (
                <span className={r.totalPoints ? "text-good" : textFaint}>
                  {r.totalPoints != null ? `+${r.totalPoints} pts` : "En attente du calcul des points"}
                </span>
              ) : (
                <span className={textFaint}>Match pas encore terminé</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function TeamBadge({ name, logoUrl, theme }: { name: string; logoUrl: string | null; theme: "none" | "dark" | "light" }) {
  return (
    <span className="flex w-20 flex-col items-center gap-1.5 text-center">
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <span className={`block h-10 w-10 shrink-0 rounded-full ${leagueCardTeamPlaceholderClass(theme)}`} />
      )}
      <span className={`text-[11px] font-bold leading-tight ${leagueCardTeamTextClass(theme)}`}>{name}</span>
    </span>
  );
}

/** null = match pas encore terminé (rien à valider), true/false = pronostic buteur/passeur juste ou non. */
function ValidityTag({ valid, points }: { valid: boolean | null; points: number }) {
  if (valid === null) return <span>(en attente)</span>;
  if (valid) return <span className="font-bold text-good">✓ validé (+{points}pts)</span>;
  return <span className="font-bold text-bad">✕ non validé</span>;
}
