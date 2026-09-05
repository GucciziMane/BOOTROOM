import Image from "next/image";
import { formatParisDateTime } from "@/lib/format-date";
import { LEAGUE_FLAG, LEAGUE_COLOR } from "@/lib/country-flags";
import type { PredictionHistoryRow } from "@/lib/predictions";

export function PredictionHistoryList({ rows }: { rows: PredictionHistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-mute">Aucun pronostic pour l&apos;instant.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div
          key={r.matchId}
          className="rounded-2xl border border-line bg-paper p-4 shadow-sm"
          style={{ borderLeftColor: LEAGUE_COLOR[r.leagueCode], borderLeftWidth: 4 }}
        >
          <p className="mb-2 flex items-center justify-between text-xs font-bold text-mute">
            <span>{formatParisDateTime(r.kickoffAt)}</span>
            <span>
              {LEAGUE_FLAG[r.leagueCode] ?? ""} {r.leagueName}
              {r.matchday != null ? ` · J${r.matchday}` : ""}
            </span>
          </p>

          <div className="flex items-center justify-center gap-4">
            <TeamBadge name={r.homeName} logoUrl={r.homeLogoUrl} />

            <div className="flex flex-col items-center gap-1">
              <span className="text-lg font-bold">
                {r.predictedHome} – {r.predictedAway}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wide text-mute">Pronostic</span>
              {r.isFinished ? (
                <>
                  <span className="mt-1 text-lg font-bold text-ink">
                    {r.realHome} – {r.realAway}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-mute">Score réel</span>
                </>
              ) : (
                <span className="mt-1 text-xs font-bold text-mute">
                  {r.realHome != null && r.realAway != null ? `En cours : ${r.realHome}-${r.realAway}` : "À venir"}
                </span>
              )}
            </div>

            <TeamBadge name={r.awayName} logoUrl={r.awayLogoUrl} />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-mute">
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

          <p className="mt-3 text-center text-sm font-bold">
            {r.isFinished ? (
              <span className={r.totalPoints ? "text-good" : "text-mute"}>
                {r.totalPoints != null ? `+${r.totalPoints} pts` : "En attente du calcul des points"}
              </span>
            ) : (
              <span className="text-mute">Match pas encore terminé</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

function TeamBadge({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className="flex w-20 flex-col items-center gap-1.5 text-center">
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <span className="block h-10 w-10 shrink-0 rounded-full bg-cream" />
      )}
      <span className="text-[11px] font-bold leading-tight">{name}</span>
    </span>
  );
}

/** null = match pas encore terminé (rien à valider), true/false = pronostic buteur/passeur juste ou non. */
function ValidityTag({ valid, points }: { valid: boolean | null; points: number }) {
  if (valid === null) return <span>(en attente)</span>;
  if (valid) return <span className="font-bold text-good">✓ validé (+{points}pts)</span>;
  return <span className="font-bold text-bad">✕ non validé</span>;
}
