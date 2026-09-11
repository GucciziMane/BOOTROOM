import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushToUserIds } from "@/lib/push/server";

// Tourne toutes les heures (voir .github/workflows/quiz-reminders.yml) et ne fait quelque chose
// qu'à 18h heure de Paris — même raisonnement que quiz-reminders (évite un horaire UTC fixe qui
// dérive à chaque changement heure été/hiver). Une fois par jour, avant la plupart des coups
// d'envoi du soir : le moment le plus utile pour ne pas rater le verrou d'un pronostic sans pour
// autant spammer (contrairement au rappel email quotidien, à J-48h de chaque deadline précise —
// voir prediction-reminders/route.ts —, ceci est volontairement un simple rappel push générique).
const REMINDER_HOUR = 18;
// Fenêtre "matchs proches" : au-delà, un rappel à 18h n'a pas encore de sens (trop tôt pour la
// plupart des utilisateurs) — 24h couvre les matchs du soir même jusqu'au lendemain même heure.
const WINDOW_HOURS = 24;

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const parisHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false })
  );
  if (parisHour !== REMINDER_HOUR) {
    return NextResponse.json({ skipped: true, parisHour });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  const { data: activeLeagues } = await supabase.from("leagues").select("id").eq("active", true);
  const activeLeagueIds = (activeLeagues ?? []).map((l) => l.id);
  if (activeLeagueIds.length === 0) return NextResponse.json({ reminded: 0 });

  const { data: matches } = await supabase
    .from("matches")
    .select("id")
    .eq("status", "scheduled")
    .in("league_id", activeLeagueIds)
    .gte("kickoff_at", now.toISOString())
    .lte("kickoff_at", windowEnd.toISOString());

  if (!matches || matches.length === 0) return NextResponse.json({ reminded: 0 });
  const matchIds = matches.map((m) => m.id);

  const { data: profiles } = await supabase.from("profiles").select("id");
  const allUserIds = (profiles ?? []).map((p) => p.id);
  if (allUserIds.length === 0) return NextResponse.json({ reminded: 0 });

  const { data: predictions } = await supabase
    .from("match_predictions")
    .select("user_id, match_id")
    .in("match_id", matchIds);
  const predictedMatchIdsByUser = new Map<string, Set<number>>();
  for (const p of predictions ?? []) {
    if (!predictedMatchIdsByUser.has(p.user_id)) predictedMatchIdsByUser.set(p.user_id, new Set());
    predictedMatchIdsByUser.get(p.user_id)!.add(p.match_id);
  }

  const pendingUserIds = allUserIds.filter((userId) => {
    const predicted = predictedMatchIdsByUser.get(userId) ?? new Set();
    return matchIds.some((id) => !predicted.has(id));
  });
  if (pendingUserIds.length === 0) return NextResponse.json({ reminded: 0 });

  await sendPushToUserIds(pendingUserIds, {
    title: "Boot Room 🎯",
    body: "Des matchs approchent — pense à faire tes pronostics avant la fermeture des paris.",
    url: "/calendar",
  });

  return NextResponse.json({ reminded: pendingUserIds.length });
}
