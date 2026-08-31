import Link from "next/link";
import Image from "next/image";
import type { ClubHomeData } from "@/lib/club-home";
import { darken } from "@/lib/color";
import { formatParisDateTime } from "@/lib/format-date";

const POSITION_LABEL: Record<string, string> = {
  Goalkeeper: "Gardien",
  Defender: "Défenseur",
  Midfielder: "Milieu",
  Attacker: "Attaquant",
};

const ORDINAL = (n: number) => (n === 1 ? "1ère" : `${n}e`);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function ClubHomeDashboard({ data }: { data: ClubHomeData }) {
  const gradient = `linear-gradient(160deg, ${data.primaryColor}, ${darken(data.primaryColor, 0.55)})`;
  const accent = data.secondaryColor ?? "#ffffff";
  const matchHref = (matchId: number) =>
    data.standing ? `/leagues/${data.standing.leagueCode}/calendar/${matchId}` : "/calendar";

  return (
    <div>
      {/* Bandeau club */}
      <div
        className="rounded-[28px] px-6 py-7 text-center text-white shadow-sm"
        style={{ background: gradient }}
      >
        {data.logoUrl && (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white p-3 shadow-lg">
            <Image src={data.logoUrl} alt="" width={56} height={56} className="h-full w-full object-contain" priority />
          </div>
        )}
        <div className="mt-3 text-xl font-bold">{data.teamName}</div>
        <div className="mt-0.5 text-sm text-white/60">{data.standing?.leagueName ?? "Ton club favori"}</div>

        {data.standing && (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center justify-center rounded-2xl bg-white/10 px-2 py-3">
              <div className="text-lg font-extrabold" style={{ color: accent }}>
                {ORDINAL(data.standing.position)}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-white/65">Position</div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-2xl bg-white/10 px-2 py-3">
              <div className="text-lg font-extrabold" style={{ color: accent }}>
                {data.standing.points}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-white/65">Points</div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-2xl bg-white/10 px-2 py-3">
              {data.standing.form.length > 0 ? (
                <div className="flex items-center justify-center gap-1 py-2">
                  {data.standing.form.map((r, i) => (
                    <span
                      key={i}
                      className={`h-2 w-2 rounded-full ${r === "W" ? "bg-good" : r === "L" ? "bg-bad" : "bg-white/50"}`}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-lg font-extrabold text-white/50">&mdash;</div>
              )}
              <div className="mt-0.5 text-[10px] font-semibold text-white/65">Forme</div>
            </div>
          </div>
        )}
      </div>

      {/* Prochain match */}
      {data.nextMatch && (
        <Link
          href={matchHref(data.nextMatch.id)}
          className="-mt-4 mx-3 flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 shadow-md transition-colors hover:border-ink"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-mute">Prochain match</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-bold">
              {data.nextMatch.opponentLogoUrl && (
                <Image
                  src={data.nextMatch.opponentLogoUrl}
                  alt=""
                  width={20}
                  height={20}
                  className="h-5 w-5 shrink-0 object-contain"
                />
              )}
              <span className="truncate">
                {data.nextMatch.isHome ? "vs" : "@"} {data.nextMatch.opponentName}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-mute">{formatParisDateTime(data.nextMatch.kickoffAt)}</div>
          </div>
          <span
            className="shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold text-white"
            style={{ backgroundColor: data.primaryColor }}
          >
            Pronostiquer
          </span>
        </Link>
      )}

      {/* Classement */}
      {data.standing && data.standing.tableWindow.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">Classement {data.standing.leagueName}</span>
            <Link href={`/calendar/classements/${data.standing.leagueCode}`} className="text-xs font-bold text-accent">
              Voir tout
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            {data.standing.tableWindow.map((row) => (
              <div
                key={row.teamId}
                className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-b-0"
                style={row.teamId === data.teamId ? { backgroundColor: `${data.primaryColor}0f` } : undefined}
              >
                <span className="w-4 text-xs font-extrabold text-mute">{row.position}</span>
                {row.logoUrl && <Image src={row.logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />}
                <span className={`flex-1 truncate text-xs ${row.teamId === data.teamId ? "font-extrabold" : "font-medium"}`}>
                  {row.teamName}
                </span>
                <span className="text-xs font-extrabold">{row.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dernier résultat */}
      {data.lastResult && data.lastResult.homeScore !== null && data.lastResult.awayScore !== null && (
        <div className="mt-6">
          <div className="mb-2 text-sm font-bold">Dernier résultat</div>
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-paper p-4">
            {data.logoUrl && <Image src={data.logoUrl} alt="" width={28} height={28} className="h-7 w-7 object-contain" />}
            <span className="text-lg font-extrabold">
              {data.lastResult.isHome ? data.lastResult.homeScore : data.lastResult.awayScore}
              {" – "}
              {data.lastResult.isHome ? data.lastResult.awayScore : data.lastResult.homeScore}
            </span>
            {data.lastResult.opponentLogoUrl && (
              <Image src={data.lastResult.opponentLogoUrl} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
            )}
          </div>
          <div className="mt-1.5 text-center text-xs text-mute">
            {data.teamName} {data.lastResult.isHome ? "–" : "@"} {data.lastResult.opponentName} &middot;{" "}
            {formatParisDateTime(data.lastResult.kickoffAt)}
          </div>
        </div>
      )}

      {/* Effectif */}
      {data.squad.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-sm font-bold">L&rsquo;effectif</div>
          <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1">
            {data.squad.map((p) => (
              <div key={p.id} className="w-24 shrink-0 rounded-2xl border border-line bg-paper p-3 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2" style={{ borderColor: accent, background: darken(data.primaryColor, 0.55) }}>
                  {p.photoUrl ? (
                    <Image src={p.photoUrl} alt="" width={48} height={48} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-extrabold" style={{ color: accent }}>
                      {initials(p.name)}
                    </span>
                  )}
                </div>
                <div className="mt-2 truncate text-[11px] font-bold">{p.name}</div>
                <div className="text-[10px] text-mute">{POSITION_LABEL[p.position] ?? p.position}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
