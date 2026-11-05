import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushBroadcastWithOverrides } from "@/lib/push/server";
import { fetchWeekLedger, previousLeaderboardWeek, WEEKLY_WINNER_BONUS_POINTS } from "@/lib/leaderboard-week";

// Tourne tous les lundis (voir vercel.json) : le n°1 du classement de la semaine qui vient de se
// terminer (lundi 00h -> lundi 00h, Paris — voir lib/leaderboard-week, partagé avec la page
// classement pour que le gagnant soit exactement celui affiché) reçoit +100 points au classement
// général. Ex aequo à la première place : chacun reçoit les +100. Remplace la prime à l'outsider.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const week = previousLeaderboardWeek();

  // Idempotence : un redéploiement ou un double-déclenchement du cron ne doit pas retraiter la
  // même semaine (la contrainte unique (week_start, user_id) protège aussi en dernier ressort).
  const { data: existing } = await supabase
    .from("weekly_winner_bonuses")
    .select("id")
    .eq("week_start", week.weekStart)
    .limit(1);
  if (existing && existing.length > 0) return NextResponse.json({ skipped: "week already processed", week: week.isoWeek });

  const { data: leagues } = await supabase.from("leagues").select("id").eq("active", true);
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));
  const { rows } = await fetchWeekLedger(supabase, week, activeLeagueIds);

  const totalByUser = new Map<string, number>();
  for (const row of rows) totalByUser.set(row.user_id, (totalByUser.get(row.user_id) ?? 0) + row.points);
  const best = Math.max(0, ...totalByUser.values());
  const winners = [...totalByUser.entries()].filter(([, pts]) => pts === best && best > 0).map(([userId]) => userId);

  const base = { week_start: week.weekStart, iso_year: week.isoYear, iso_week: week.isoWeek };

  if (winners.length === 0) {
    // Personne n'a marqué de points de prono cette semaine (trêve, off-season...) : rien à
    // distribuer, mais on fige quand même la semaine pour ne pas la retraiter en boucle.
    await supabase.from("weekly_winner_bonuses").insert({ ...base, user_id: null, week_points: 0, points: 0 });
    return NextResponse.json({ skipped: "no prediction points this week", week: week.isoWeek });
  }

  // Claim AVANT tout effet visible (ledger, chat, push) : un seul INSERT multi-lignes est atomique,
  // donc un run concurrent qui perd la course sur la contrainte unique échoue en entier et
  // abandonne plutôt que de doubler le bonus.
  const { data: claimed, error: claimError } = await supabase
    .from("weekly_winner_bonuses")
    .insert(winners.map((userId) => ({ ...base, user_id: userId, week_points: best, points: WEEKLY_WINNER_BONUS_POINTS })))
    .select("id, user_id");
  if (claimError || !claimed || claimed.length === 0) {
    return NextResponse.json({ skipped: "already claimed by a concurrent run" });
  }

  // source_id = id de la ligne weekly_winner_bonuses (une par gagnant) — même rôle que pour
  // weekly_outsider_bonus / midseason_bonus_gift.
  const { error: ledgerError } = await supabase.from("points_ledger").insert(
    claimed.map((c) => ({
      user_id: c.user_id as string,
      league_id: null,
      source_type: "weekly_winner_bonus" as const,
      source_id: c.id,
      points: WEEKLY_WINNER_BONUS_POINTS,
    }))
  );
  if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 500 });

  const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", winners);
  const names = winners.map((id) => profiles?.find((p) => p.id === id)?.username ?? "Un joueur");
  const namesText = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;

  await supabase.from("chat_messages").insert({
    user_id: null,
    is_system: true,
    content:
      winners.length === 1
        ? `👑 Semaine ${week.isoWeek} : ${namesText} remporte le classement de la semaine avec ${best} pts — +${WEEKLY_WINNER_BONUS_POINTS} points au classement général ! Nouvelle semaine, tout le monde repart à zéro.`
        : `👑 Semaine ${week.isoWeek} : égalité en tête à ${best} pts entre ${namesText} — +${WEEKLY_WINNER_BONUS_POINTS} points chacun au classement général ! Nouvelle semaine, tout le monde repart à zéro.`,
  });

  await sendPushBroadcastWithOverrides(
    new Map(
      winners.map((userId) => [
        userId,
        {
          title: "Boot Room 👑",
          body: `Tu remportes la semaine ${week.isoWeek} avec ${best} pts — +${WEEKLY_WINNER_BONUS_POINTS} points au classement général !`,
          url: "/leaderboard",
        },
      ])
    ),
    {
      title: "Boot Room 👑",
      body: `Semaine ${week.isoWeek} : ${namesText} ${winners.length === 1 ? "gagne" : "gagnent"} +${WEEKLY_WINNER_BONUS_POINTS} pts. Nouvelle semaine, tout le monde repart à zéro !`,
      url: "/leaderboard",
    }
  );

  return NextResponse.json({ awarded: true, week: week.isoWeek, winners, weekPoints: best });
}
