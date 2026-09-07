// Récap ponctuel demandé par l'utilisateur pour patienter avant le premier récap automatique de
// journée (voir src/lib/chat/matchday-recap.ts) : un tour d'horizon amusant du début de saison,
// tous championnats confondus, posté une seule fois dans le chat. Contrairement au récap
// automatique (déclenché par journée complète), celui-ci agrège tout ce qui est déjà noté depuis
// le début de la saison — à lancer à la main, jamais par un cron.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LEAGUE_FLAG = { FL1: "🇫🇷", PL: "🇬🇧", PD: "🇪🇸", BL1: "🇩🇪", PPL: "🇵🇹" };
const SYSTEM_SENDER_NAME = "Gianni Infantino";

async function main() {
  const { data: leagues } = await supabase.from("leagues").select("id, name, football_data_code").eq("active", true);
  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, league_id, year")
    .in("league_id", (leagues ?? []).map((l) => l.id))
    .order("year", { ascending: false });
  const currentSeasonByLeague = new Map();
  for (const s of seasons ?? []) {
    if (!currentSeasonByLeague.has(s.league_id)) currentSeasonByLeague.set(s.league_id, s);
  }
  const seasonIds = [...currentSeasonByLeague.values()].map((s) => s.id);
  const leagueById = new Map((leagues ?? []).map((l) => [l.id, l]));

  const { data: matches } = await supabase
    .from("matches")
    .select("id, league_id, season_id, matchday, home_team_id, away_team_id, home_score, away_score")
    .in("season_id", seasonIds)
    .eq("status", "finished")
    .not("points_processed_at", "is", null)
    .not("matchday", "is", null);

  const matchIds = (matches ?? []).map((m) => m.id);
  const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

  const [{ data: predictions }, { data: profiles }, { data: teams }, { data: ledger }] = await Promise.all([
    supabase
      .from("match_predictions")
      .select("user_id, match_id, points_awarded")
      .in("match_id", matchIds.length > 0 ? matchIds : [-1]),
    supabase.from("profiles").select("id, username"),
    supabase.from("teams").select("id, name"),
    supabase.from("points_ledger").select("user_id, points, source_type, source_id"),
  ]);

  const usernameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const matchLabel = (matchId) => {
    const m = matchById.get(matchId);
    if (!m) return "?";
    const league = leagueById.get(m.league_id);
    const flag = league ? (LEAGUE_FLAG[league.football_data_code] ?? "") : "";
    return `${flag} ${teamNameById.get(m.home_team_id) ?? "?"} ${m.home_score}-${m.away_score} ${teamNameById.get(m.away_team_id) ?? "?"}`;
  };

  if (!predictions || predictions.length === 0) {
    console.log("Rien à raconter : aucun pronostic noté pour l'instant.");
    return;
  }

  // Meilleur / pire prono individuel de la saison.
  let best = predictions[0];
  let worst = predictions[0];
  for (const p of predictions) {
    if ((p.points_awarded ?? 0) > (best.points_awarded ?? 0)) best = p;
    if ((p.points_awarded ?? 0) < (worst.points_awarded ?? 0)) worst = p;
  }

  // MVP par journée : pour chaque (league, matchday), qui a le plus de points cumulés ; on compte
  // ensuite combien de journées chacun a gagnées.
  const totalsByGroup = new Map(); // "league:matchday" -> Map(userId -> points)
  for (const p of predictions) {
    const m = matchById.get(p.match_id);
    if (!m) continue;
    const key = `${m.league_id}:${m.matchday}`;
    if (!totalsByGroup.has(key)) totalsByGroup.set(key, new Map());
    const perUser = totalsByGroup.get(key);
    perUser.set(p.user_id, (perUser.get(p.user_id) ?? 0) + (p.points_awarded ?? 0));
  }
  const journeesGagneesByUser = new Map();
  for (const perUser of totalsByGroup.values()) {
    let bestUser = null;
    let bestPoints = -Infinity;
    for (const [userId, points] of perUser) {
      if (points > bestPoints) {
        bestPoints = points;
        bestUser = userId;
      }
    }
    if (bestUser) journeesGagneesByUser.set(bestUser, (journeesGagneesByUser.get(bestUser) ?? 0) + 1);
  }
  const topMvp = [...journeesGagneesByUser.entries()].sort((a, b) => b[1] - a[1])[0];

  // Flair buteur : plus gros total de points "match_scorer" (pronostics buteur réussis) sur la
  // saison, tous championnats confondus.
  const scorerPointsByUser = new Map();
  for (const row of ledger ?? []) {
    if (row.source_type !== "match_scorer") continue;
    scorerPointsByUser.set(row.user_id, (scorerPointsByUser.get(row.user_id) ?? 0) + row.points);
  }
  const topScorerPicker = [...scorerPointsByUser.entries()].sort((a, b) => b[1] - a[1])[0];

  // Classement général actuel (mêmes données que /leaderboard).
  const totalByUser = new Map();
  for (const row of ledger ?? []) {
    totalByUser.set(row.user_id, (totalByUser.get(row.user_id) ?? 0) + row.points);
  }
  const predictingUserIds = new Set(predictions.map((p) => p.user_id));
  const ranked = [...profiles ?? []]
    .map((p) => ({ id: p.id, username: p.username, total: totalByUser.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);
  const rankedActive = ranked.filter((p) => predictingUserIds.has(p.id));

  const name = (userId) => usernameById.get(userId) ?? "quelqu'un";

  const lines = [];
  lines.push("🏁 Récap de début de saison — tous championnats confondus");
  lines.push("");
  lines.push("Classement général provisoire :");
  const medals = ["🥇", "🥈", "🥉"];
  ranked.slice(0, 3).forEach((p, i) => lines.push(`${medals[i]} @${p.username} — ${p.total} pts`));
  if (rankedActive.length > 3) {
    const last = rankedActive[rankedActive.length - 1];
    lines.push(`🔴 Et tout en bas... @${last.username} avec ${last.total} pts. Courage.`);
  }
  lines.push("");
  lines.push(`🎯 Le prono le plus propre de la saison : @${name(best.user_id)} avec ${best.points_awarded ?? 0} pts sur ${matchLabel(best.match_id)}.`);
  if (worst.user_id !== best.user_id) {
    lines.push(`💀 Le naufrage de la saison : @${name(worst.user_id)}, ${worst.points_awarded ?? 0} pts sur ${matchLabel(worst.match_id)}.`);
  }
  if (topMvp) {
    lines.push(`🏆 @${name(topMvp[0])} a été le·la meilleur·e de la journée à ${topMvp[1]} reprise${topMvp[1] > 1 ? "s" : ""} depuis le début de la saison. Les autres ramassent les miettes.`);
  }
  if (topScorerPicker && topScorerPicker[1] > 0) {
    lines.push(`👁️ Meilleur flair buteur : @${name(topScorerPicker[0])}, ${topScorerPicker[1]} pts rien qu'en devinant les buteurs.`);
  }
  lines.push("");
  lines.push("À partir de maintenant, un récap automatique arrivera dès qu'une journée se termine 👀");

  const content = lines.join("\n");
  console.log("--- Contenu du récap ---\n" + content + "\n------------------------");

  if (process.env.DRY_RUN === "1") {
    console.log("DRY_RUN=1 : rien n'a été posté.");
    return;
  }

  const { error } = await supabase.from("chat_messages").insert({ user_id: null, content, is_system: true });
  if (error) throw new Error(`Échec de l'insertion : ${error.message}`);
  console.log("Posté dans le chat.");
}

main();
