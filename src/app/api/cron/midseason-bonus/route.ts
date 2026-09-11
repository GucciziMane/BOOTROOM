import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushToUserIds } from "@/lib/push/server";
import { fetchLeaderboardTotals } from "@/lib/leaderboard-totals";

// Tourne une fois par an, le 26 décembre (voir vercel.json) : le top 3 du classement général à cet
// instant reçoit chacun un malus à usage unique — -100/-75/-50 points à infliger au joueur de leur
// choix (voir src/app/leaderboard/actions.ts, spendMidseasonBonus) — à utiliser avant le 1er janvier.
const AMOUNTS = [100, 75, 50];

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const seasonYear = new Date().getUTCFullYear();

  // Idempotence : un redéploiement ou un double-déclenchement du cron ne doit pas réattribuer (la
  // contrainte unique (user_id, season_year) protège aussi en dernier ressort côté insert).
  const { count } = await supabase
    .from("midseason_bonuses")
    .select("id", { count: "exact", head: true })
    .eq("season_year", seasonYear);
  if ((count ?? 0) > 0) return NextResponse.json({ skipped: "already granted" });

  const { data: leagues } = await supabase.from("leagues").select("id").eq("active", true);
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));
  const { totalByUser } = await fetchLeaderboardTotals(supabase, activeLeagueIds);

  const top3 = [...totalByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top3.length < 3) return NextResponse.json({ skipped: "fewer than 3 ranked players" });

  const expiresAt = new Date(Date.UTC(seasonYear + 1, 0, 1)).toISOString(); // 1er janvier, 00:00 UTC

  const rows = top3.map(([userId], i) => ({
    user_id: userId,
    season_year: seasonYear,
    rank: i + 1,
    amount: AMOUNTS[i],
    expires_at: expiresAt,
  }));
  const { error: insertError } = await supabase.from("midseason_bonuses").insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  // Annonce dans le chat (même pattern que postMatchdayRecaps, cf. src/lib/chat/matchday-recap.ts)
  // + notif push aux 3 gagnants : ils n'ont que 7 jours pour l'utiliser, autant les prévenir tout
  // de suite plutôt qu'ils tombent dessus par hasard en rouvrant l'appli.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username")
    .in(
      "id",
      rows.map((r) => r.user_id)
    );
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const lines = rows.map((r) => `🏆 ${nameById.get(r.user_id) ?? "?"} — bonus mi-saison : -${r.amount} pts à distribuer`);
  await supabase.from("chat_messages").insert({
    user_id: null,
    is_system: true,
    content: `Bonus de mi-saison attribués !\n${lines.join("\n")}\nÀ utiliser avant le 1er janvier.`,
  });

  await sendPushToUserIds(
    rows.map((r) => r.user_id),
    {
      title: "Boot Room 🏆",
      body: "Bonus de mi-saison débloqué — inflige un malus au joueur de ton choix avant le 1er janvier !",
      url: "/leaderboard",
    }
  );

  return NextResponse.json({ granted: rows.length });
}
