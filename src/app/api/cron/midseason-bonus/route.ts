import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushToUserIds } from "@/lib/push/server";
import { fetchLeaderboardTotals } from "@/lib/leaderboard-totals";

// Tourne une fois par an, le 26 décembre (voir vercel.json) : le classement général à cet instant
// détermine deux pouvoirs à usage unique, à utiliser avant le 1er janvier (voir
// src/app/leaderboard/actions.ts, spendMidseasonBonus) —
//  - le top 3 reçoit un MALUS : -100/-75/-50 points à infliger au joueur de son choix.
//  - le bottom 3 reçoit un cadeau forcé (symétrique, `kind: "bonus"`) : +100/+75/+50 points à
//    OFFRIR à un joueur de son choix — la punition est d'être forcé d'avantager un adversaire,
//    pas une perte de points pour celui qui offre (comme le malus n'en coûte aucun à celui qui
//    l'inflige).
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

  const sorted = [...totalByUser.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = sorted.slice(0, 3);
  // >= 6 pour garantir que top3 et bottom3 ne se recoupent jamais (sinon un même joueur pourrait
  // se retrouver à la fois "gagnant" et "dernier").
  const bottom3 = sorted.length >= 6 ? sorted.slice(-3).reverse() : []; // reverse : le dernier (rank 1) en premier

  if (top3.length < 3 && bottom3.length < 3) {
    return NextResponse.json({ skipped: "not enough ranked players" });
  }

  const expiresAt = new Date(Date.UTC(seasonYear + 1, 0, 1)).toISOString(); // 1er janvier, 00:00 UTC

  const malusRows = (top3.length === 3 ? top3 : []).map(([userId], i) => ({
    user_id: userId,
    season_year: seasonYear,
    rank: i + 1,
    amount: AMOUNTS[i],
    kind: "malus" as const,
    expires_at: expiresAt,
  }));
  const bonusRows = bottom3.map(([userId], i) => ({
    user_id: userId,
    season_year: seasonYear,
    rank: i + 1,
    amount: AMOUNTS[i],
    kind: "bonus" as const,
    expires_at: expiresAt,
  }));
  const rows = [...malusRows, ...bonusRows];

  const { error: insertError } = await supabase.from("midseason_bonuses").insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  // Annonce dans le chat (même pattern que postMatchdayRecaps, cf. src/lib/chat/matchday-recap.ts)
  // + notif push à tout le monde : ils n'ont que 7 jours pour l'utiliser, autant les prévenir tout
  // de suite plutôt qu'ils tombent dessus par hasard en rouvrant l'appli.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username")
    .in(
      "id",
      rows.map((r) => r.user_id)
    );
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const malusLines = malusRows.map((r) => `🏆 ${nameById.get(r.user_id) ?? "?"} — bonus mi-saison : -${r.amount} pts à distribuer`);
  const bonusLines = bonusRows.map((r) => `💩 ${nameById.get(r.user_id) ?? "?"} — bonus mi-saison : +${r.amount} pts à offrir (punition du classement)`);
  await supabase.from("chat_messages").insert({
    user_id: null,
    is_system: true,
    content: `Bonus de mi-saison attribués !\n${[...malusLines, ...bonusLines].join("\n")}\nÀ utiliser avant le 1er janvier.`,
  });

  await sendPushToUserIds(
    rows.map((r) => r.user_id),
    {
      title: "Boot Room 🏆",
      body: "Bonus de mi-saison débloqué — direction le classement pour l'utiliser avant le 1er janvier !",
      url: "/leaderboard",
    }
  );

  return NextResponse.json({ granted: rows.length, malus: malusRows.length, bonus: bonusRows.length });
}
