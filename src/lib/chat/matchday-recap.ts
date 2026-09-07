import type { ServiceClient } from "@/app/api/cron/process-scoring/route";
import { sendPushToOthers } from "@/lib/push/server";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import { SYSTEM_SENDER_NAME } from "@/lib/system-sender";

export interface TouchedMatchdayGroup {
  seasonId: number;
  leagueId: number;
  matchday: number;
}

const BEST_PHRASES = [
  (user: string, match: string, points: number) =>
    `👑 @${user} a explosé la journée avec ${points} pts sur ${match}. Respect (ou pas).`,
  (user: string, match: string, points: number) =>
    `🔥 @${user} a lu ${match} comme un livre ouvert : ${points} pts. Les autres, on repassera.`,
  (user: string, match: string, points: number) =>
    `🎯 Prono du jour : @${user}, ${points} pts sur ${match}. Ça sent le coaching devant Téléfoot.`,
];

const WORST_PHRASES = [
  (user: string, match: string, points: number) =>
    `💀 @${user} a mis ${points} pts sur ${match}. On a mal pour toi.`,
  (user: string, match: string, points: number) =>
    `🤡 @${user}, ${points} pts sur ${match}. Prédit les yeux fermés ou quoi ?`,
  (user: string, match: string, points: number) =>
    `🚨 Alerte boulet : @${user} termine à ${points} pts sur ${match}. Reviens vite (ou pas).`,
];

const STREAK_PHRASES = [
  (user: string, streak: number) =>
    `📈 @${user} enchaîne ${streak} journées de suite en tête. Ça devient gênant pour les autres.`,
  (user: string, streak: number) =>
    `🐐 ${streak} journées d'affilée au sommet pour @${user}. Quelqu'un pour l'arrêter ?`,
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Pour chaque (saison, journée) touchée par le lot de matchs qu'on vient de traiter, poste un
 * récap dans le chat dès que TOUS les matchs de cette journée sont finis + notés — pas seulement
 * ceux de ce lot, d'où une requête fraîche plutôt que de se fier au seul contenu du lot (peu
 * importe quel run de cron finit le dernier match, la complétude se vérifie en base à chaque
 * fois). matchday_recaps sert à la fois de garde anti-doublon et d'historique pour les séries.
 */
export async function postMatchdayRecaps(supabase: ServiceClient, groups: TouchedMatchdayGroup[]): Promise<void> {
  const seen = new Set<string>();
  const uniqueGroups = groups.filter((g) => {
    const key = `${g.seasonId}:${g.matchday}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const group of uniqueGroups) {
    await postOneMatchdayRecap(supabase, group);
  }
}

async function postOneMatchdayRecap(supabase: ServiceClient, group: TouchedMatchdayGroup): Promise<void> {
  const { data: existing } = await supabase
    .from("matchday_recaps")
    .select("id")
    .eq("season_id", group.seasonId)
    .eq("matchday", group.matchday)
    .maybeSingle();
  if (existing) return;

  const { data: matchdayMatches } = await supabase
    .from("matches")
    .select("id, status, points_processed_at, home_team_id, away_team_id, home_score, away_score")
    .eq("season_id", group.seasonId)
    .eq("matchday", group.matchday);
  if (!matchdayMatches || matchdayMatches.length === 0) return;
  const allDone = matchdayMatches.every((m) => m.status === "finished" && m.points_processed_at != null);
  if (!allDone) return;

  const matchIds = matchdayMatches.map((m) => m.id);
  const { data: predictions } = await supabase
    .from("match_predictions")
    .select("user_id, match_id, points_awarded")
    .in("match_id", matchIds);
  if (!predictions || predictions.length === 0) return; // personne n'a pronostiqué cette journée : rien à raconter

  let best = predictions[0];
  let worst = predictions[0];
  const totalByUser = new Map<string, number>();
  for (const p of predictions) {
    const points = p.points_awarded ?? 0;
    if (points > (best.points_awarded ?? 0)) best = p;
    if (points < (worst.points_awarded ?? 0)) worst = p;
    totalByUser.set(p.user_id, (totalByUser.get(p.user_id) ?? 0) + points);
  }
  const [topUserId] = [...totalByUser.entries()].sort((a, b) => b[1] - a[1])[0];

  const [{ data: profiles }, { data: teams }, { data: league }] = await Promise.all([
    supabase.from("profiles").select("id, username"),
    supabase.from("teams").select("id, name").in("id", [
      ...new Set(matchdayMatches.flatMap((m) => [m.home_team_id, m.away_team_id])),
    ]),
    supabase.from("leagues").select("name, football_data_code").eq("id", group.leagueId).single(),
  ]);
  const usernameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const matchLabel = (matchId: number) => {
    const m = matchdayMatches.find((mm) => mm.id === matchId);
    if (!m) return "?";
    return `${teamNameById.get(m.home_team_id) ?? "?"} ${m.home_score}-${m.away_score} ${teamNameById.get(m.away_team_id) ?? "?"}`;
  };

  const bestUsername = usernameById.get(best.user_id) ?? "quelqu'un";
  const worstUsername = usernameById.get(worst.user_id) ?? "quelqu'un";
  const topUsername = usernameById.get(topUserId) ?? "quelqu'un";

  const lines: string[] = [];
  const flag = league?.football_data_code ? (LEAGUE_FLAG[league.football_data_code] ?? "") : "";
  lines.push(`📊 Récap ${flag} ${league?.name ?? "championnat"} · Journée ${group.matchday}`);
  lines.push("");
  lines.push(pick(BEST_PHRASES)(bestUsername, matchLabel(best.match_id), best.points_awarded ?? 0));
  // Pas la peine d'afficher un "pire prono" distinct si une seule personne a pronostiqué, ou si
  // c'est la même perf que le meilleur (ex: tout le monde à 0).
  if (predictions.length > 1 && worst.user_id !== best.user_id) {
    lines.push(pick(WORST_PHRASES)(worstUsername, matchLabel(worst.match_id), worst.points_awarded ?? 0));
  }

  const { data: history } = await supabase
    .from("matchday_recaps")
    .select("matchday, top_user_id")
    .eq("season_id", group.seasonId)
    .order("matchday", { ascending: false });
  let streak = 1;
  let expectedMatchday = group.matchday - 1;
  for (const h of history ?? []) {
    if (h.matchday === expectedMatchday && h.top_user_id === topUserId) {
      streak++;
      expectedMatchday--;
    } else {
      break;
    }
  }
  if (streak >= 2) lines.push(pick(STREAK_PHRASES)(topUsername, streak));

  const content = lines.join("\n");

  await supabase.from("chat_messages").insert({ user_id: null, content, is_system: true });
  await supabase.from("matchday_recaps").insert({
    season_id: group.seasonId,
    league_id: group.leagueId,
    matchday: group.matchday,
    top_user_id: topUserId,
  });

  try {
    await sendPushToOthers([], {
      title: SYSTEM_SENDER_NAME,
      body: `📊 Journée ${group.matchday} ${league?.name ?? ""} terminée — @${topUsername} en tête.`,
      url: "/chat",
    });
  } catch {
    // Le récap est déjà posté dans le chat : un souci d'envoi push ne doit pas faire échouer le run.
  }
}
