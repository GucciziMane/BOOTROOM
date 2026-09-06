// Corrige un bug découvert le 6/09 : getEspnMatchGoals ne retenait que le type exact "goal",
// ratant en silence "goal---header", "goal---volley", "own-goal", "penalty---scored", etc. —
// des buts réels jamais enregistrés dans match_goals, et donc des pronostics buteur/passeur
// comptés perdants à tort sur des matchs déjà "points_processed_at" (jamais retraités par le cron
// normal). Ce script, à lancer une fois après le fix de src/lib/espn/client.ts :
//   1. Repère les matchs terminés où le nombre de buts enregistrés est inférieur au score réel.
//   2. Réinterroge ESPN avec la logique corrigée (scoringPlay) et régénère match_goals au complet.
//   3. Recalcule seulement les points buteur/passeur (jamais le score, déjà correct) pour les
//      pronostics de ces matchs, et ajoute en base ce qui manquait — jamais de retrait de points
//      déjà attribués à raison.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_LEAGUE_SLUG = { FL1: "fra.1", PL: "eng.1", PD: "esp.1", BL1: "ger.1", PPL: "por.1" };

const SPECIAL_LETTERS = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ł: "l", ı: "i" };
const TOKEN_ALIASES = { rennes: "rennais", lyon: "lyonnais", munich: "munchen", estac: "es" };
const CONNECTORS = new Set(["de", "del", "des", "la", "le", "les", "el", "of", "the"]);

function normalizeName(raw) {
  return raw
    .toLowerCase()
    .replace(/[øæœßđłı]/g, (c) => SPECIAL_LETTERS[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(fc|cf|sc|ac|as|rc|ol|om|psg|club|calcio|cd|ud|sd|uc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((t) => TOKEN_ALIASES[t] ?? t)
    .join(" ");
}

function teamNamesMatch(a, b) {
  const ta = normalizeName(a).split(" ").filter(Boolean);
  const tb = normalizeName(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  const fa = ta.filter((t) => !CONNECTORS.has(t));
  const fb = tb.filter((t) => !CONNECTORS.has(t));
  const [shortTokens, longTokens] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (shortTokens.length > 0 && shortTokens.every((t) => longTokens.includes(t))) return true;
  const common = shortTokens.filter((t) => longTokens.includes(t));
  const shortRest = shortTokens.filter((t) => !common.includes(t));
  const longRest = longTokens.filter((t) => !common.includes(t));
  if (shortRest.length === 1 && shortRest[0].length >= 2 && shortRest[0].length <= 5 && longRest.length >= 2) {
    const initials = longRest.map((w) => w[0]).join("");
    if (initials === shortRest[0]) return true;
  }
  return false;
}

function matchPlayerByName(targetName, candidates) {
  const targetLastName = normalizeName(targetName).split(" ").pop();
  if (!targetLastName) return null;
  const matches = candidates.filter((c) => normalizeName(c.name).split(" ").includes(targetLastName));
  return matches.length === 1 ? matches[0] : null;
}

async function espnFetch(path) {
  const res = await fetch(`${ESPN_BASE}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ESPN ${path} -> ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. Charger tout ce qu'il faut en une poignée de requêtes ---

const { data: leagues } = await supabase.from("leagues").select("id, football_data_code");
const slugByLeagueId = new Map(leagues.map((l) => [l.id, ESPN_LEAGUE_SLUG[l.football_data_code]]));

const { data: matches } = await supabase
  .from("matches")
  .select("id, league_id, season_id, home_team_id, away_team_id, home_score, away_score, kickoff_at")
  .eq("status", "finished")
  .not("home_score", "is", null)
  .not("away_score", "is", null);

const matchIds = matches.map((m) => m.id);
const { data: existingGoals } = await supabase
  .from("match_goals")
  .select("match_id, player_id, assist_player_id")
  .in("match_id", matchIds);
const goalCountByMatch = new Map();
for (const g of existingGoals) goalCountByMatch.set(g.match_id, (goalCountByMatch.get(g.match_id) ?? 0) + 1);

const incomplete = matches.filter((m) => {
  const expected = m.home_score + m.away_score;
  const have = goalCountByMatch.get(m.id) ?? 0;
  return expected > 0 && have < expected;
});
console.log(`${matches.length} matchs terminés, ${incomplete.length} avec moins de buts enregistrés que le score réel.`);

if (incomplete.length === 0) {
  console.log("Rien à corriger.");
  process.exit(0);
}

const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))];
const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
const teamById = new Map(teams.map((t) => [t.id, t]));
const { data: players } = await supabase.from("players").select("id, name, team_id").in("team_id", teamIds);
const playersByTeam = new Map();
for (const p of players) {
  if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
  playersByTeam.get(p.team_id).push(p);
}

// --- 2. Pour chaque match incomplet, retrouver l'événement ESPN et régénérer match_goals ---

const scoreboardCache = new Map(); // `${slug}|${ymd}` -> events
const changedMatchIds = [];
let unmatched = 0;

for (const match of incomplete) {
  const slug = slugByLeagueId.get(match.league_id);
  if (!slug) {
    unmatched++;
    continue;
  }
  const homeName = teamById.get(match.home_team_id)?.name ?? "";
  const awayName = teamById.get(match.away_team_id)?.name ?? "";
  const ymd = match.kickoff_at.slice(0, 10).replace(/-/g, "");
  const cacheKey = `${slug}|${ymd}`;

  let events = scoreboardCache.get(cacheKey);
  if (events === undefined) {
    try {
      const data = await espnFetch(`/${slug}/scoreboard?dates=${ymd}&limit=200`);
      events = data.events ?? [];
    } catch (err) {
      console.log(`  scoreboard ${cacheKey} indisponible: ${err.message}`);
      events = null;
    }
    scoreboardCache.set(cacheKey, events);
    await sleep(300);
  }
  if (!events) {
    unmatched++;
    continue;
  }

  const event = events.find((e) => {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    return home && away && teamNamesMatch(home.team.displayName, homeName) && teamNamesMatch(away.team.displayName, awayName);
  });
  if (!event) {
    console.log(`  pas de match ESPN pour ${homeName} - ${awayName} (${match.kickoff_at.slice(0, 10)})`);
    unmatched++;
    continue;
  }

  let summary;
  try {
    summary = await espnFetch(`/${slug}/summary?event=${event.id}`);
  } catch (err) {
    console.log(`  summary ${event.id} indisponible: ${err.message}`);
    unmatched++;
    continue;
  }
  await sleep(300);

  const goalEvents = (summary.keyEvents ?? []).filter(
    (e) => e.scoringPlay && e.team && e.participants && e.participants.length > 0
  );

  const goalRows = goalEvents.flatMap((e) => {
    const teamId = teamNamesMatch(e.team.displayName, homeName) ? match.home_team_id : match.away_team_id;
    const scorer = matchPlayerByName(e.participants[0].athlete.displayName, playersByTeam.get(teamId) ?? []);
    const assist = e.participants[1] ? matchPlayerByName(e.participants[1].athlete.displayName, playersByTeam.get(teamId) ?? []) : null;
    if (!scorer) return [];
    const minuteMatch = e.clock?.displayValue?.match(/\d+/);
    return [
      {
        match_id: match.id,
        team_id: teamId,
        player_id: scorer.id,
        assist_player_id: assist?.id ?? null,
        minute: minuteMatch ? Number(minuteMatch[0]) : null,
      },
    ];
  });

  const before = goalCountByMatch.get(match.id) ?? 0;
  if (goalRows.length <= before) {
    console.log(`  ${homeName} - ${awayName}: ESPN ne donne pas plus que ce qu'on a déjà (${goalRows.length} vs ${before}), ignoré.`);
    continue;
  }

  await supabase.from("match_goals").delete().eq("match_id", match.id);
  if (goalRows.length > 0) await supabase.from("match_goals").insert(goalRows);
  console.log(`  ${homeName} ${match.home_score}-${match.away_score} ${awayName}: ${before} -> ${goalRows.length} buts enregistrés`);
  changedMatchIds.push(match.id);
}

console.log(`\n${changedMatchIds.length} matchs corrigés, ${unmatched} non retrouvés sur ESPN (laissés tels quels).`);

if (changedMatchIds.length === 0) {
  console.log("Aucun point à recalculer.");
  process.exit(0);
}

// --- 3. Recalculer uniquement les points buteur/passeur des pronostics de ces matchs ---

const { data: scorerTierPoints } = await supabase.from("match_scorer_tier_points").select("tier, points");
const scorerTierPointsMap = new Map(scorerTierPoints.map((t) => [t.tier, t.points]));
const { data: assistTierPoints } = await supabase.from("match_assist_tier_points").select("tier, points");
const assistTierPointsMap = new Map(assistTierPoints.map((t) => [t.tier, t.points]));
const FALLBACK_TIER = 3;

const changedMatches = matches.filter((m) => changedMatchIds.includes(m.id));
const seasonIds = [...new Set(changedMatches.map((m) => m.season_id))];
const { data: scorerTierRows } = await supabase.from("player_scoring_tier").select("player_id, tier").in("season_id", seasonIds);
const scorerTierByPlayer = new Map(scorerTierRows.map((r) => [r.player_id, r.tier]));
const { data: assistTierRows } = await supabase.from("player_assist_tier").select("player_id, tier").in("season_id", seasonIds);
const assistTierByPlayer = new Map(assistTierRows.map((r) => [r.player_id, r.tier]));

const { data: newGoals } = await supabase.from("match_goals").select("match_id, player_id, assist_player_id").in("match_id", changedMatchIds);
const scorersByMatch = new Map();
const assistersByMatch = new Map();
for (const g of newGoals) {
  if (g.player_id != null) {
    if (!scorersByMatch.has(g.match_id)) scorersByMatch.set(g.match_id, new Set());
    scorersByMatch.get(g.match_id).add(g.player_id);
  }
  if (g.assist_player_id != null) {
    if (!assistersByMatch.has(g.match_id)) assistersByMatch.set(g.match_id, new Set());
    assistersByMatch.get(g.match_id).add(g.assist_player_id);
  }
}

const { data: predictions } = await supabase
  .from("match_predictions")
  .select("id, match_id, user_id, predicted_scorer_player_id, predicted_assist_player_id, points_awarded")
  .in("match_id", changedMatchIds);
// league_id n'existe pas sur match_predictions : on le reprend depuis le match.
const leagueIdByMatch = new Map(matches.map((m) => [m.id, m.league_id]));

const { data: existingLedger } = await supabase
  .from("points_ledger")
  .select("user_id, source_type, source_id")
  .in("source_id", changedMatchIds)
  .in("source_type", ["match_scorer", "match_assist"]);
const alreadyAwarded = new Set(existingLedger.map((r) => `${r.source_id}:${r.user_id}:${r.source_type}`));

const ledgerInserts = [];
const predictionUpdates = [];

for (const pred of predictions) {
  const actualScorers = scorersByMatch.get(pred.match_id) ?? new Set();
  const actualAssisters = assistersByMatch.get(pred.match_id) ?? new Set();

  const scorerPoints =
    pred.predicted_scorer_player_id && actualScorers.has(pred.predicted_scorer_player_id)
      ? (scorerTierPointsMap.get(scorerTierByPlayer.get(pred.predicted_scorer_player_id) ?? FALLBACK_TIER) ?? 40)
      : 0;
  const assistPoints =
    pred.predicted_assist_player_id && actualAssisters.has(pred.predicted_assist_player_id)
      ? (assistTierPointsMap.get(assistTierByPlayer.get(pred.predicted_assist_player_id) ?? FALLBACK_TIER) ?? 28)
      : 0;

  let added = 0;
  if (scorerPoints > 0 && !alreadyAwarded.has(`${pred.match_id}:${pred.user_id}:match_scorer`)) {
    ledgerInserts.push({ user_id: pred.user_id, league_id: leagueIdByMatch.get(pred.match_id), source_type: "match_scorer", source_id: pred.match_id, points: scorerPoints });
    added += scorerPoints;
  }
  if (assistPoints > 0 && !alreadyAwarded.has(`${pred.match_id}:${pred.user_id}:match_assist`)) {
    ledgerInserts.push({ user_id: pred.user_id, league_id: leagueIdByMatch.get(pred.match_id), source_type: "match_assist", source_id: pred.match_id, points: assistPoints });
    added += assistPoints;
  }
  if (added > 0) {
    predictionUpdates.push({ id: pred.id, points_awarded: (pred.points_awarded ?? 0) + added, added, user_id: pred.user_id, match_id: pred.match_id });
  }
}

if (ledgerInserts.length > 0) {
  const { error } = await supabase.from("points_ledger").insert(ledgerInserts);
  if (error) console.error("Erreur insertion points_ledger:", error.message);
}
for (const u of predictionUpdates) {
  await supabase.from("match_predictions").update({ points_awarded: u.points_awarded }).eq("id", u.id);
}

console.log(`\n${predictionUpdates.length} pronostics corrigés, +${ledgerInserts.reduce((s, l) => s + l.points, 0)} points au total rattrapés :`);
for (const u of predictionUpdates) {
  console.log(`  match ${u.match_id}, user ${u.user_id}: +${u.added} pts (total pronostic: ${u.points_awarded})`);
}
