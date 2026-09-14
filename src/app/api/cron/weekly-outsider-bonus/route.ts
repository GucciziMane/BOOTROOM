import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushBroadcastWithOverrides } from "@/lib/push/server";
import { fetchLeaderboardTotals } from "@/lib/leaderboard-totals";
import { parisDateString } from "@/lib/quiz/daily";

// Tourne tous les lundis (voir vercel.json) : "la semaine" = les 7 jours qui viennent de s'écouler
// (lundi dernier 00h -> ce lundi 00h). Si la personne qui a le mieux pronostiqué sur cette fenêtre,
// tous championnats actifs confondus, n'est PAS dans le top 3 du classement général actuel, elle
// reçoit une prime fixe de 50 points — voir migration 0056_weekly_outsider_bonus pour le pourquoi
// (garder tout le monde dans la course au titre, même décroché en milieu de saison).
const OUTSIDER_BONUS_POINTS = 50;
const TOP_N_EXCLUDED = 3;

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();

  // Même simplification de frontière de jour que fetchFinishedMatches/getDailyQuiz ailleurs dans
  // l'appli (YYYY-MM-DDT00:00:00Z plutôt que le vrai minuit Europe/Paris) : suffisant pour une
  // fenêtre d'une semaine, et cohérent avec le reste du code plutôt que d'introduire une troisième
  // façon de calculer une frontière de jour.
  const todayStr = parisDateString();
  const weekEnd = new Date(`${todayStr}T00:00:00Z`);
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  // Idempotence : un redéploiement ou un double-déclenchement du cron ne doit pas retraiter la
  // même semaine (la contrainte unique week_start protège aussi en dernier ressort côté insert).
  const { data: existing } = await supabase
    .from("weekly_outsider_bonuses")
    .select("id")
    .eq("week_start", weekStartStr)
    .maybeSingle();
  if (existing) return NextResponse.json({ skipped: "week already processed" });

  const { data: leagues } = await supabase.from("leagues").select("id").eq("active", true);
  const activeLeagueIds = new Set((leagues ?? []).map((l) => l.id));

  // Points de pronostics uniquement (league_id non nul) sur la fenêtre : une prime "mi-saison" ou
  // "quiz" gagnée cette même semaine ne doit pas compter pour départager qui a le mieux pronostiqué
  // — ce mini-jeu porte spécifiquement sur les pronostics, pas sur le total général.
  const { data: weekLedger } = await supabase
    .from("points_ledger")
    .select("user_id, league_id, points, created_at")
    .not("league_id", "is", null)
    .gte("created_at", weekStart.toISOString())
    .lt("created_at", weekEnd.toISOString());

  const weekTotalByUser = new Map<string, number>();
  for (const row of weekLedger ?? []) {
    if (!activeLeagueIds.has(row.league_id!)) continue;
    weekTotalByUser.set(row.user_id, (weekTotalByUser.get(row.user_id) ?? 0) + row.points);
  }
  const weekRanking = [...weekTotalByUser.entries()].sort((a, b) => b[1] - a[1]);

  if (weekRanking.length === 0) {
    // Personne n'a marqué de points de prono cette semaine (trêve internationale, off-season...) :
    // rien à distribuer, mais on fige quand même la semaine pour ne pas la retraiter en boucle.
    await supabase.from("weekly_outsider_bonuses").insert({ week_start: weekStartStr, user_id: null, points: 0 });
    return NextResponse.json({ skipped: "no prediction points this week" });
  }

  const { totalByUser } = await fetchLeaderboardTotals(supabase, activeLeagueIds);
  const generalRanking = [...totalByUser.entries()].sort((a, b) => b[1] - a[1]);
  const topUserIds = new Set(generalRanking.slice(0, TOP_N_EXCLUDED).map(([userId]) => userId));

  // Le meilleur pronostiqueur de la semaine HORS top 3, pas seulement le tout premier : si le n°1
  // de la semaine est déjà dans le top 3 général, la prime va au premier de la liste qui n'y est
  // pas plutôt que de ne rien distribuer cette semaine-là — sinon une semaine dominée par le
  // classement établi ne récompense jamais personne, ce qui va à l'encontre du but du mini-jeu.
  const bestOutsider = weekRanking.find(([userId]) => !topUserIds.has(userId));

  // Claim AVANT tout effet visible (message chat, notif push) — même raisonnement que
  // midseason-bonus/matchday-recap : la contrainte unique week_start protège une double écriture
  // concurrente, celle qui perd la course abandonne silencieusement plutôt que de doubler la prime.
  const { data: claimed, error: claimError } = await supabase
    .from("weekly_outsider_bonuses")
    .insert({
      week_start: weekStartStr,
      user_id: bestOutsider ? bestOutsider[0] : null,
      points: bestOutsider ? OUTSIDER_BONUS_POINTS : 0,
    })
    .select("id")
    .single();
  if (claimError || !claimed) return NextResponse.json({ skipped: "already claimed by a concurrent run" });

  if (!bestOutsider) {
    // N'arrive en pratique que si tout le monde ayant marqué des points de prono cette semaine
    // fait déjà partie du top 3 général (groupe restreint de joueurs) — rien à distribuer.
    return NextResponse.json({ skipped: "no eligible outsider this week" });
  }
  const [bestUserId, bestPoints] = bestOutsider;

  // source_id : pas de match/saison ici (contrairement aux autres source_type), l'id de la ligne
  // weekly_outsider_bonuses elle-même sert d'identifiant unique — même rôle que bonus.id pour
  // midseason_malus/midseason_bonus_gift.
  await supabase.from("points_ledger").insert({
    user_id: bestUserId,
    league_id: null,
    source_type: "weekly_outsider_bonus",
    source_id: claimed.id,
    points: OUTSIDER_BONUS_POINTS,
  });

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", bestUserId).single();
  const username = profile?.username ?? "Un joueur";

  await supabase.from("chat_messages").insert({
    user_id: null,
    is_system: true,
    content: `🏹 Prime à l'outsider ! ${username} a fait le meilleur score de pronostics de la semaine (${bestPoints} pts) sans être dans le top 3 — +${OUTSIDER_BONUS_POINTS} points bonus au classement général !`,
  });

  // À tout le monde, pas seulement au gagnant — même pattern que postMatchdayRecaps (annonce de
  // chat = notif à tous les abonnés), message personnalisé pour le gagnant, générique pour les
  // autres. sendPushToUserIds([bestUserId], ...) ne notifiait QUE le gagnant, personne d'autre ne
  // voyait jamais passer l'annonce alors même qu'elle vient d'être postée dans le chat de tous.
  await sendPushBroadcastWithOverrides(
    new Map([
      [
        bestUserId,
        {
          title: "Boot Room 🏹",
          body: `Meilleur pronostiqueur de la semaine hors du top 3 — tu gagnes ${OUTSIDER_BONUS_POINTS} points bonus !`,
          url: "/leaderboard",
        },
      ],
    ]),
    {
      title: "Boot Room 🏹",
      body: `Prime à l'outsider : ${username} décroche +${OUTSIDER_BONUS_POINTS} points bonus cette semaine.`,
      url: "/leaderboard",
    }
  );

  return NextResponse.json({ awarded: true, bestUserId, bestPoints, bonus: OUTSIDER_BONUS_POINTS });
}
