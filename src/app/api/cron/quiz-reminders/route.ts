import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushToUserIds } from "@/lib/push/server";
import { parisDateString } from "@/lib/quiz/daily";

// Tourne toutes les heures (voir .github/workflows/quiz-reminders.yml) et ne fait quelque chose
// qu'à midi et 18h heure de Paris : évite d'avoir à recalculer/mettre à jour un horaire UTC fixe
// à chaque changement d'heure été/hiver.
const REMINDER_HOURS = [12, 18];

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const parisHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false })
  );
  if (!REMINDER_HOURS.includes(parisHour)) {
    return NextResponse.json({ skipped: true, parisHour });
  }

  const supabase = createServiceRoleClient();
  const quizDate = parisDateString();

  const { data: profiles } = await supabase.from("profiles").select("id");
  const allUserIds = (profiles ?? []).map((p) => p.id);
  if (allUserIds.length === 0) return NextResponse.json({ reminded: 0 });

  const { data: results } = await supabase.from("quiz_results").select("user_id").eq("quiz_date", quizDate);
  const doneSet = new Set((results ?? []).map((r) => r.user_id));

  const pendingUserIds = allUserIds.filter((id) => !doneSet.has(id));
  if (pendingUserIds.length === 0) return NextResponse.json({ reminded: 0 });

  await sendPushToUserIds(pendingUserIds, {
    title: "Boot Room 🧠",
    body: "Le quiz du jour t'attend toujours — 10 questions, 2 minutes.",
    url: "/quiz",
  });

  return NextResponse.json({ reminded: pendingUserIds.length });
}
