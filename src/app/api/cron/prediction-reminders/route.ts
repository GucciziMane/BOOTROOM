import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend";
import { formatParisDateTime } from "@/lib/format-date";

/** Fenêtre de repérage des deadlines à venir : le cron tourne une fois par jour, donc une
 * deadline reste visible ~24-48h avant, le temps qu'elle passe dans cette fenêtre au moins
 * une fois. reminder_log empêche de relancer deux fois le même utilisateur pour la même deadline. */
const WINDOW_HOURS = 48;
const APP_URL = "https://bootroom.online";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

interface UserReminder {
  matches: { label: string; kickoffAt: string }[];
  seasons: { leagueName: string }[];
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  const { data: profiles } = await supabase.from("profiles").select("id, username");
  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ matches: 0, seasons: 0, emailsSent: 0 });
  }
  const allUserIds = profiles.map((p) => p.id);

  const {
    data: { users: authUsers },
  } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const emailByUserId = new Map(
    authUsers
      .map((u): [string, string] | null => (u.email ? [u.id, u.email] : null))
      .filter((entry): entry is [string, string] => entry !== null)
  );

  const reminders = new Map<string, UserReminder>();
  const toLog: { user_id: string; kind: "match" | "season"; source_id: number }[] = [];

  const matchCount = await collectMatchReminders(supabase, now, windowEnd, allUserIds, reminders, toLog);
  const seasonCount = await collectSeasonReminders(supabase, now, windowEnd, allUserIds, reminders, toLog);

  let emailsSent = 0;
  for (const [userId, reminder] of reminders) {
    const email = emailByUserId.get(userId);
    if (!email) continue;

    try {
      await sendEmail(email, "Boot Room — il te reste des pronostics à faire", renderReminderEmail(reminder));
      emailsSent++;
    } catch {
      continue; // ne pas marquer comme envoyé si l'email a échoué : retenté au prochain run
    }

    const logsForUser = toLog.filter((l) => l.user_id === userId);
    if (logsForUser.length > 0) {
      await supabase.from("reminder_log").insert(logsForUser);
    }
  }

  return NextResponse.json({ matches: matchCount, seasons: seasonCount, emailsSent });
}

async function collectMatchReminders(
  supabase: ServiceClient,
  now: Date,
  windowEnd: Date,
  allUserIds: string[],
  reminders: Map<string, UserReminder>,
  toLog: { user_id: string; kind: "match" | "season"; source_id: number }[]
): Promise<number> {
  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "match_prediction_lock_hours_before_kickoff")
    .maybeSingle();
  const lockHours = Number(setting?.value ?? 1);

  const kickoffFrom = new Date(now.getTime() + lockHours * 60 * 60 * 1000);
  const kickoffTo = new Date(windowEnd.getTime() + lockHours * 60 * 60 * 1000);

  const { data: activeLeagues } = await supabase.from("leagues").select("id, name").eq("active", true);
  const activeLeagueIds = (activeLeagues ?? []).map((l) => l.id);
  const leagueNameById = new Map((activeLeagues ?? []).map((l) => [l.id, l.name]));
  if (activeLeagueIds.length === 0) return 0;

  const { data: matches } = await supabase
    .from("matches")
    .select("id, league_id, home_team_id, away_team_id, kickoff_at")
    .eq("status", "scheduled")
    .in("league_id", activeLeagueIds)
    .gte("kickoff_at", kickoffFrom.toISOString())
    .lte("kickoff_at", kickoffTo.toISOString());

  if (!matches || matches.length === 0) return 0;

  const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const matchIds = matches.map((m) => m.id);
  const { data: predictions } = await supabase.from("match_predictions").select("user_id, match_id").in("match_id", matchIds);
  const predictedByMatch = new Map<number, Set<string>>();
  for (const p of predictions ?? []) {
    if (!predictedByMatch.has(p.match_id)) predictedByMatch.set(p.match_id, new Set());
    predictedByMatch.get(p.match_id)!.add(p.user_id);
  }

  const { data: alreadyLogged } = await supabase
    .from("reminder_log")
    .select("user_id, source_id")
    .eq("kind", "match")
    .in("source_id", matchIds);
  const loggedSet = new Set((alreadyLogged ?? []).map((l) => `${l.user_id}:${l.source_id}`));

  for (const match of matches) {
    const predicted = predictedByMatch.get(match.id) ?? new Set();
    for (const userId of allUserIds) {
      if (predicted.has(userId)) continue;
      if (loggedSet.has(`${userId}:${match.id}`)) continue;

      const label = `${leagueNameById.get(match.league_id) ?? ""} : ${teamNameById.get(match.home_team_id) ?? "?"} - ${teamNameById.get(match.away_team_id) ?? "?"}`;
      if (!reminders.has(userId)) reminders.set(userId, { matches: [], seasons: [] });
      reminders.get(userId)!.matches.push({ label, kickoffAt: match.kickoff_at });
      toLog.push({ user_id: userId, kind: "match", source_id: match.id });
    }
  }

  return matches.length;
}

async function collectSeasonReminders(
  supabase: ServiceClient,
  now: Date,
  windowEnd: Date,
  allUserIds: string[],
  reminders: Map<string, UserReminder>,
  toLog: { user_id: string; kind: "match" | "season"; source_id: number }[]
): Promise<number> {
  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, league_id, predictions_lock_at")
    .neq("status", "finished")
    .gte("predictions_lock_at", now.toISOString())
    .lte("predictions_lock_at", windowEnd.toISOString());

  if (!seasons || seasons.length === 0) return 0;

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name")
    .in(
      "id",
      seasons.map((s) => s.league_id)
    );
  const leagueNameById = new Map((leagues ?? []).map((l) => [l.id, l.name]));

  const seasonIds = seasons.map((s) => s.id);
  const { data: predictions } = await supabase.from("season_predictions").select("user_id, season_id").in("season_id", seasonIds);
  const predictedBySeason = new Map<number, Set<string>>();
  for (const p of predictions ?? []) {
    if (!predictedBySeason.has(p.season_id)) predictedBySeason.set(p.season_id, new Set());
    predictedBySeason.get(p.season_id)!.add(p.user_id);
  }

  const { data: alreadyLogged } = await supabase
    .from("reminder_log")
    .select("user_id, source_id")
    .eq("kind", "season")
    .in("source_id", seasonIds);
  const loggedSet = new Set((alreadyLogged ?? []).map((l) => `${l.user_id}:${l.source_id}`));

  for (const season of seasons) {
    const predicted = predictedBySeason.get(season.id) ?? new Set();
    for (const userId of allUserIds) {
      if (predicted.has(userId)) continue;
      if (loggedSet.has(`${userId}:${season.id}`)) continue;

      if (!reminders.has(userId)) reminders.set(userId, { matches: [], seasons: [] });
      reminders.get(userId)!.seasons.push({ leagueName: leagueNameById.get(season.league_id) ?? "" });
      toLog.push({ user_id: userId, kind: "season", source_id: season.id });
    }
  }

  return seasons.length;
}

function renderReminderEmail(reminder: UserReminder): string {
  const matchItems = reminder.matches
    .map((m) => `<li>${m.label} — ${formatParisDateTime(m.kickoffAt)}</li>`)
    .join("");
  const seasonItems = reminder.seasons.map((s) => `<li>${s.leagueName} : buteur, passeur, top 3, flop 3, équipe surprise et équipe flop</li>`).join("");

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">Boot Room</h1>
      <p>Il te reste des pronostics à faire avant la fermeture des paris :</p>
      ${matchItems ? `<p><strong>Matchs (score + buteur)</strong></p><ul>${matchItems}</ul>` : ""}
      ${seasonItems ? `<p><strong>Prédictions de saison</strong></p><ul>${seasonItems}</ul>` : ""}
      <p><a href="${APP_URL}/calendar">Faire mes pronostics</a></p>
    </div>
  `;
}
