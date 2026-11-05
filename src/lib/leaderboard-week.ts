import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Classement de la semaine : lundi 00h -> lundi 00h, heure de Paris (vrai minuit Europe/Paris, pas
// l'approximation T00:00:00Z utilisée par la prime outsider — ici la frontière décide qui gagne
// +100 points, une heure de décalage sur un match du dimanche soir changerait le gagnant).
// Partagé entre leaderboard/page.tsx et api/cron/weekly-winner-bonus pour que le n°1 affiché à
// l'écran soit exactement celui qui reçoit le bonus.

export const WEEKLY_WINNER_BONUS_POINTS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LeaderboardWeek {
  /** Lundi de la semaine, date de Paris (YYYY-MM-DD). */
  weekStart: string;
  /** Lundi 00h Paris, en UTC. */
  startUtc: Date;
  /** Lundi suivant 00h Paris, en UTC (borne exclue). */
  endUtc: Date;
  isoYear: number;
  isoWeek: number;
}

/** Décalage Paris - UTC (ms) à un instant donné — 1h l'hiver, 2h l'été. */
function parisOffsetMs(at: Date): number {
  const local = at.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace(" ", "T");
  return Date.parse(`${local}Z`) - at.getTime();
}

/** Minuit Europe/Paris du jour YYYY-MM-DD, en UTC. */
function parisMidnightUtc(ymd: string): Date {
  const naive = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(naive - parisOffsetMs(new Date(naive)));
}

/** Semaine (lundi -> lundi, Paris) contenant l'instant `at`. */
export function leaderboardWeekOf(at: Date = new Date()): LeaderboardWeek {
  const parisDay = at.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
  const dayUtc = Date.parse(`${parisDay}T00:00:00Z`);
  const mondayUtc = dayUtc - ((new Date(dayUtc).getUTCDay() + 6) % 7) * DAY_MS;
  const weekStart = new Date(mondayUtc).toISOString().slice(0, 10);
  const nextMonday = new Date(mondayUtc + 7 * DAY_MS).toISOString().slice(0, 10);

  // Numéro de semaine ISO 8601 (celui des calendriers français) : la semaine appartient à l'année
  // de son jeudi, et la semaine 1 est celle qui contient le premier jeudi de l'année.
  const thursday = new Date(mondayUtc + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const isoWeek = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * DAY_MS)) + 1;

  return { weekStart, startUtc: parisMidnightUtc(weekStart), endUtc: parisMidnightUtc(nextMonday), isoYear, isoWeek };
}

/** Semaine précédant celle qui contient `at`. */
export function previousLeaderboardWeek(at: Date = new Date()): LeaderboardWeek {
  return leaderboardWeekOf(new Date(leaderboardWeekOf(at).startUtc.getTime() - 1));
}

/** "du 2 au 8 novembre" (ou "du 27 octobre au 2 novembre"). */
export function formatWeekRange(week: LeaderboardWeek): string {
  const first = new Date(`${week.weekStart}T12:00:00Z`);
  const last = new Date(first.getTime() + 6 * DAY_MS);
  const day = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric" });
  const dayMonth = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });
  return first.getUTCMonth() === last.getUTCMonth()
    ? `du ${day(first)} au ${dayMonth(last)}`
    : `du ${dayMonth(first)} au ${dayMonth(last)}`;
}

export interface WeekLedgerRow {
  user_id: string;
  league_id: number;
  points: number;
}

/** Points de pronos (score, buteur, passeur) des matchs de championnats actifs dont le coup
 * d'envoi tombe dans la semaine — rattachés au match, pas à la date de versement : un match du
 * dimanche soir payé lundi 1h compte bien pour la semaine qui se termine. Les bonus (quiz,
 * mi-saison, Ballon d'or, ce bonus hebdo lui-même) n'en font jamais partie. */
export async function fetchWeekLedger(
  supabase: SupabaseClient<Database>,
  week: LeaderboardWeek,
  activeLeagueIds: Set<number>
): Promise<{ rows: WeekLedgerRow[]; matchIds: number[] }> {
  const { data: matches } = await supabase
    .from("matches")
    .select("id, league_id")
    .gte("kickoff_at", week.startUtc.toISOString())
    .lt("kickoff_at", week.endUtc.toISOString());
  const matchIds = (matches ?? []).filter((m) => activeLeagueIds.has(m.league_id)).map((m) => m.id);
  if (matchIds.length === 0) return { rows: [], matchIds };

  const { data: ledger } = await supabase
    .from("points_ledger")
    .select("user_id, league_id, points")
    .in("source_type", ["match_score", "match_scorer", "match_assist"])
    .in("source_id", matchIds)
    .order("user_id", { ascending: true });
  const rows = (ledger ?? [])
    .filter((r): r is WeekLedgerRow => r.league_id != null && activeLeagueIds.has(r.league_id))
    .map((r) => ({ user_id: r.user_id, league_id: r.league_id, points: r.points }));
  return { rows, matchIds };
}
