import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushToUserIds } from "@/lib/push/server";
import { QUIZ_SEASON_RESET_KEY } from "@/lib/leaderboard-reset";
import { summarizeQuizResults } from "@/lib/quiz/season-summary";

// Tourne une fois par an, le 1er janvier (voir vercel.json) : clôture la saison quiz qui vient de
// se terminer (31 décembre) — le 1er du classement "Saison" reçoit +100 points sur le classement
// général des pronos, le 2e +50 (points_ledger, league_id null — comme le bonus mi-saison, un
// gain sur le classement général n'a pas de sens par championnat) — puis fait repartir la saison
// quiz à zéro en avançant QUIZ_SEASON_RESET_KEY à aujourd'hui. Le classement des pronos lui-même
// n'est jamais touché par ce reset : seule la saison quiz redémarre.
const AMOUNTS = [100, 50];

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const seasonYear = new Date().getUTCFullYear() - 1; // la saison qui vient de se terminer, pas celle qui commence

  // Idempotence : si la coupure a déjà été avancée à cette année (redéploiement, double
  // déclenchement), ne rien refaire.
  const { data: resetSetting } = await supabase.from("app_settings").select("value").eq("key", QUIZ_SEASON_RESET_KEY).maybeSingle();
  const newResetAt = new Date(Date.UTC(seasonYear + 1, 0, 1)).toISOString(); // 1er janvier, 00:00 UTC
  if (resetSetting?.value && resetSetting.value >= newResetAt) {
    return NextResponse.json({ skipped: "already rolled over" });
  }

  let query = supabase.from("quiz_results").select("user_id, score").lt("completed_at", newResetAt);
  if (resetSetting?.value) query = query.gte("completed_at", resetSetting.value);
  const { data: results } = await query;

  if (results && results.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in(
        "id",
        [...new Set(results.map((r) => r.user_id))]
      );
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const top2 = summarizeQuizResults(results, profileById).slice(0, 2);

    if (top2.length === 2) {
      const rows = top2.map((r, i) => ({
        user_id: r.userId,
        league_id: null,
        source_type: "quiz_season_bonus" as const,
        source_id: seasonYear,
        points: AMOUNTS[i],
      }));
      const { error: insertError } = await supabase.from("points_ledger").insert(rows);
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

      const lines = top2.map((r, i) => `🧠 ${r.username} — +${AMOUNTS[i]} pts sur le classement général (saison quiz ${seasonYear})`);
      await supabase.from("chat_messages").insert({
        user_id: null,
        is_system: true,
        content: `Saison quiz ${seasonYear} terminée !\n${lines.join("\n")}\nNouvelle saison quiz lancée aujourd'hui.`,
      });

      await sendPushToUserIds(
        top2.map((r) => r.userId),
        {
          title: "Boot Room 🧠",
          body: "Saison quiz terminée — tu gagnes des points bonus sur le classement général !",
          url: "/leaderboard",
        }
      );
    }
  }

  await supabase.from("app_settings").upsert({ key: QUIZ_SEASON_RESET_KEY, value: newResetAt });

  return NextResponse.json({ rolledOver: newResetAt });
}
