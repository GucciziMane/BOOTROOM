import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type QuizCategory =
  | "score"
  | "player_career"
  | "trivia"
  | "vintage_jersey"
  | "hidden_teammate"
  | "guess_crest"
  | "guess_player_team"
  | "guess_match_score"
  | "guess_player_position"
  | "league_top_scorer"
  | "guess_match_scorer";
export type QuizDifficulty = "easy" | "medium" | "hard";

export interface DailyQuestionFull {
  position: number;
  category: QuizCategory;
  difficulty: QuizDifficulty;
  question: string;
  teamLogoUrl?: string | null;
  choices: string[];
  correctIndex: number;
  explanation: string | null;
}

export type DailyQuestionPublic = Omit<DailyQuestionFull, "correctIndex" | "explanation">;

export function stripAnswer(q: DailyQuestionFull): DailyQuestionPublic {
  return {
    position: q.position,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    teamLogoUrl: q.teamLogoUrl,
    choices: q.choices,
  };
}

/** Date du jour en fuseau Europe/Paris (YYYY-MM-DD) : un nouveau quiz apparaît à minuit heure de Paris. */
export function parisDateString(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

const EPOCH = "2026-01-01";

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function dayIndex(quizDate: string): number {
  const ms = new Date(`${quizDate}T00:00:00Z`).getTime() - new Date(`${EPOCH}T00:00:00Z`).getTime();
  return Math.floor(ms / 86_400_000);
}

// PRNG déterministe (mulberry32) à partir d'une graine textuelle : même graine -> même suite,
// pour que tout le monde voie exactement le même quiz un jour donné sans rien stocker en base.
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  const rand = mulberry32(hashSeed(seedStr));
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Ordre fixe des 10 questions du jour. Seules 3 questions viennent de la banque écrite à la main
// (une par difficulté) : les 7 autres sont générées depuis les vraies données (effectifs, blasons,
// scores de matchs) et ne se répètent donc jamais, ce qui garantit l'absence de répétition sur bien
// plus de 50 jours sans avoir à écrire des centaines de questions supplémentaires.
const SLOT_PLAN: Array<{ kind: "static"; difficulty: QuizDifficulty } | { kind: "dynamic" }> = [
  { kind: "dynamic" },
  { kind: "static", difficulty: "easy" },
  { kind: "dynamic" },
  { kind: "dynamic" },
  { kind: "static", difficulty: "medium" },
  { kind: "dynamic" },
  { kind: "dynamic" },
  { kind: "static", difficulty: "hard" },
  { kind: "dynamic" },
  { kind: "dynamic" },
];

interface QuestionRow {
  id: number;
  category: string;
  difficulty: string;
  question: string;
  choices: unknown;
  correct_index: number;
  explanation: string | null;
}

async function pickStaticQuestions(supabase: ServiceClient, quizDate: string): Promise<Map<number, DailyQuestionFull>> {
  // .order("id") pour la même raison que pour les données dynamiques : garantir un ordre stable
  // d'un appel à l'autre avant le mélange déterministe.
  const { data: rows } = await supabase
    .from("quiz_questions")
    .select("id, category, difficulty, question, choices, correct_index, explanation")
    .eq("active", true)
    .order("id", { ascending: true });

  const byDifficulty: Record<QuizDifficulty, QuestionRow[]> = { easy: [], medium: [], hard: [] };
  for (const r of (rows ?? []) as QuestionRow[]) byDifficulty[r.difficulty as QuizDifficulty].push(r);

  // Ordre stable (mélangé une seule fois, jamais reshuffle) : la rotation par jour se fait en
  // avançant un curseur dans cet ordre fixe, garantissant l'absence de répétition avant un tour complet.
  const order: Record<QuizDifficulty, QuestionRow[]> = {
    easy: seededShuffle(byDifficulty.easy, "quiz-bank-easy"),
    medium: seededShuffle(byDifficulty.medium, "quiz-bank-medium"),
    hard: seededShuffle(byDifficulty.hard, "quiz-bank-hard"),
  };

  const slotsPerDay: Record<QuizDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const slot of SLOT_PLAN) if (slot.kind === "static") slotsPerDay[slot.difficulty]++;

  const day = dayIndex(quizDate);
  const cursorWithinDay: Record<QuizDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const result = new Map<number, DailyQuestionFull>();

  SLOT_PLAN.forEach((slot, position) => {
    if (slot.kind !== "static") return;
    const bucket = order[slot.difficulty];
    if (!bucket || bucket.length === 0) return;
    const globalIndex = day * slotsPerDay[slot.difficulty] + cursorWithinDay[slot.difficulty];
    cursorWithinDay[slot.difficulty]++;
    const row = bucket[mod(globalIndex, bucket.length)];
    result.set(position, {
      position,
      category: row.category as QuizCategory,
      difficulty: row.difficulty as QuizDifficulty,
      question: row.question,
      choices: row.choices as unknown as string[],
      correctIndex: row.correct_index,
      explanation: row.explanation,
    });
  });

  return result;
}

interface TeamLite {
  id: number;
  name: string;
  logo_url: string | null;
}

const POSITION_LABEL: Record<string, string> = {
  Goalkeeper: "Gardien",
  Defender: "Défenseur",
  Midfielder: "Milieu",
  Attacker: "Attaquant",
};

interface PlayerLite {
  id: number;
  name: string;
  team_id: number;
  photo_url: string | null;
  position: string | null;
}

interface LeagueData {
  leagueIds: number[];
  leagueNameById: Map<number, string>;
  teams: TeamLite[];
  players: PlayerLite[];
  playersByTeam: Map<number, Array<{ id: number; name: string }>>;
}

interface MatchRow {
  id: number;
  league_id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  matchday: number | null;
}

/** Charge une seule fois les données réelles (effectifs, blasons) utilisées par tous les générateurs dynamiques. */
async function fetchLeagueData(supabase: ServiceClient): Promise<LeagueData> {
  const { data: leagues } = await supabase.from("leagues").select("id, name").eq("active", true);
  const leagueIds = (leagues ?? []).map((l) => l.id);
  const leagueNameById = new Map((leagues ?? []).map((l) => [l.id, l.name]));
  if (leagueIds.length === 0)
    return { leagueIds: [], leagueNameById, teams: [], players: [], playersByTeam: new Map() };

  // .order("id") est indispensable : sans ordre explicite, Postgres peut renvoyer les lignes dans
  // un ordre différent d'un appel à l'autre, ce qui casserait le mélange déterministe (la page
  // afficherait une question et la validation serveur en recalculerait une autre).
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, logo_url")
    .in("league_id", leagueIds)
    .order("id", { ascending: true });
  const { data: players } = await supabase
    .from("players")
    .select("id, name, team_id, photo_url, position")
    .in(
      "team_id",
      (teams ?? []).map((t) => t.id)
    )
    .is("left_at", null)
    .order("id", { ascending: true });

  const playersByTeam = new Map<number, Array<{ id: number; name: string }>>();
  for (const p of players ?? []) {
    if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
    playersByTeam.get(p.team_id)!.push({ id: p.id, name: p.name });
  }

  return { leagueIds, leagueNameById, teams: teams ?? [], players: players ?? [], playersByTeam };
}

/** Matchs terminés avant le jour du quiz — la borne évite qu'un match en cours ne change de statut
 * pendant que quelqu'un répond, ce qui ferait diverger l'affichage et la validation serveur. */
async function fetchFinishedMatches(supabase: ServiceClient, leagueIds: number[], quizDate: string): Promise<MatchRow[]> {
  if (leagueIds.length === 0) return [];
  const { data } = await supabase
    .from("matches")
    .select("id, league_id, home_team_id, away_team_id, home_score, away_score, matchday")
    .in("league_id", leagueIds)
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .lt("kickoff_at", `${quizDate}T00:00:00Z`)
    .order("id", { ascending: true });
  return (data ?? []) as MatchRow[];
}

interface GoalRow {
  match_id: number;
  team_id: number;
  player_id: number | null;
}

/** Buts des matchs terminés déjà chargés — but sans player_id (transfert non synchronisé, but
 * contre son camp — voir migration 0039) ignoré : il ne peut être crédité à aucun joueur précis. */
async function fetchGoalsForMatches(supabase: ServiceClient, matchIds: number[]): Promise<GoalRow[]> {
  if (matchIds.length === 0) return [];
  const { data } = await supabase
    .from("match_goals")
    .select("match_id, team_id, player_id")
    .in("match_id", matchIds)
    .not("player_id", "is", null)
    .order("id", { ascending: true });
  return (data ?? []) as GoalRow[];
}

/** "Ces 3 joueurs jouent dans la même équipe, qui est le 4e ?" — généré depuis les vrais effectifs. */
function genHiddenTeammate(
  data: LeagueData,
  position: number,
  seedStr: string,
  excludeTeamIds: Set<number>
): DailyQuestionFull | null {
  const eligibleTeams = data.teams.filter(
    (t) => (data.playersByTeam.get(t.id)?.length ?? 0) >= 4 && !excludeTeamIds.has(t.id)
  );
  if (eligibleTeams.length === 0) return null;

  const team = seededShuffle(eligibleTeams, `${seedStr}-team`)[0];
  excludeTeamIds.add(team.id);
  const teamPlayers = seededShuffle(data.playersByTeam.get(team.id)!, `${seedStr}-squad`);
  const [p1, p2, p3, hidden] = teamPlayers;

  const otherPlayers = data.players.filter((p) => p.team_id !== team.id);
  const decoys = seededShuffle(otherPlayers, `${seedStr}-decoys`)
    .filter((p) => p.name !== hidden.name)
    .slice(0, 3);

  const choiceObjs = seededShuffle(
    [{ id: hidden.id, name: hidden.name }, ...decoys.map((d) => ({ id: d.id, name: d.name }))],
    `${seedStr}-order`
  );
  const correctIndex = choiceObjs.findIndex((c) => c.id === hidden.id);

  return {
    position,
    category: "hidden_teammate",
    difficulty: "medium",
    question: `${p1.name}, ${p2.name} et ${p3.name} jouent tous les trois dans la même équipe. Qui est leur 4ᵉ coéquipier caché derrière le "?" ?`,
    teamLogoUrl: team.logo_url,
    choices: choiceObjs.map((c) => c.name),
    correctIndex,
    explanation: `Les quatre joueurs évoluent à ${team.name}.`,
  };
}

/** "Quel club est représenté par ce blason ?" — généré depuis les vrais blasons suivis par l'app. */
function genGuessCrest(
  data: LeagueData,
  position: number,
  seedStr: string,
  excludeTeamIds: Set<number>
): DailyQuestionFull | null {
  const teamsWithLogo = data.teams.filter((t) => t.logo_url && !excludeTeamIds.has(t.id));
  if (teamsWithLogo.length < 4) return null;

  const team = seededShuffle(teamsWithLogo, `${seedStr}-team`)[0];
  excludeTeamIds.add(team.id);
  const decoys = seededShuffle(
    teamsWithLogo.filter((t) => t.id !== team.id),
    `${seedStr}-decoys`
  ).slice(0, 3);

  const choiceObjs = seededShuffle([team, ...decoys], `${seedStr}-order`);
  const correctIndex = choiceObjs.findIndex((c) => c.id === team.id);

  return {
    position,
    category: "guess_crest",
    difficulty: "easy",
    question: "Quel club est représenté par ce blason ?",
    teamLogoUrl: team.logo_url,
    choices: choiceObjs.map((c) => c.name),
    correctIndex,
    explanation: `Il s'agit de ${team.name}.`,
  };
}

/** "Dans quel club évolue ce joueur ?" — généré depuis les vrais effectifs. */
function genGuessPlayerTeam(
  data: LeagueData,
  position: number,
  seedStr: string,
  excludePlayerIds: Set<number>
): DailyQuestionFull | null {
  const eligiblePlayers = data.players.filter((p) => !excludePlayerIds.has(p.id));
  if (eligiblePlayers.length === 0 || data.teams.length < 4) return null;

  const player = seededShuffle(eligiblePlayers, `${seedStr}-player`)[0];
  excludePlayerIds.add(player.id);
  const correctTeam = data.teams.find((t) => t.id === player.team_id);
  if (!correctTeam) return null;

  const decoys = seededShuffle(
    data.teams.filter((t) => t.id !== correctTeam.id),
    `${seedStr}-decoys`
  ).slice(0, 3);

  const choiceObjs = seededShuffle([correctTeam, ...decoys], `${seedStr}-order`);
  const correctIndex = choiceObjs.findIndex((c) => c.id === correctTeam.id);

  return {
    position,
    category: "guess_player_team",
    difficulty: "medium",
    question: `Dans quel club évolue ${player.name} ?`,
    teamLogoUrl: player.photo_url,
    choices: choiceObjs.map((c) => c.name),
    correctIndex,
    explanation: `${player.name} joue à ${correctTeam.name}.`,
  };
}

/** "Quel a été le score de ce match ?" — généré depuis les vrais résultats déjà synchronisés. */
function genGuessMatchScore(
  matches: MatchRow[],
  teamsById: Map<number, TeamLite>,
  position: number,
  seedStr: string,
  excludeMatchIds: Set<number>
): DailyQuestionFull | null {
  const eligibleMatches = matches.filter((m) => !excludeMatchIds.has(m.id));
  if (eligibleMatches.length === 0) return null;

  const match = seededShuffle(eligibleMatches, `${seedStr}-match`)[0];
  excludeMatchIds.add(match.id);
  const home = teamsById.get(match.home_team_id);
  const away = teamsById.get(match.away_team_id);
  if (!home || !away) return null;

  const h = match.home_score;
  const a = match.away_score;
  const correct = `${h}-${a}`;
  const rawCandidates = [
    `${h + 1}-${a}`,
    `${h}-${a + 1}`,
    `${a}-${h}`,
    `${Math.max(0, h - 1)}-${a}`,
    `${h}-${Math.max(0, a - 1)}`,
    `${h + 1}-${a + 1}`,
    `${h + 2}-${a}`,
    `${h}-${a + 2}`,
  ];
  const uniqueCandidates = Array.from(new Set(rawCandidates)).filter((c) => c !== correct);
  const decoys = seededShuffle(uniqueCandidates, `${seedStr}-decoys`).slice(0, 3);
  if (decoys.length < 3) return null;

  const choices = seededShuffle([correct, ...decoys], `${seedStr}-order`);
  const correctIndex = choices.indexOf(correct);

  return {
    position,
    category: "guess_match_score",
    difficulty: "medium",
    question: `Quel a été le score du match ${home.name} – ${away.name}${match.matchday ? ` (journée ${match.matchday})` : ""} ?`,
    teamLogoUrl: home.logo_url,
    choices,
    correctIndex,
    explanation: `Score final : ${correct}.`,
  };
}

/** "Quel est le poste de ce joueur ?" — généré depuis les vrais effectifs (players.position). */
function genGuessPlayerPosition(
  data: LeagueData,
  position: number,
  seedStr: string,
  excludePlayerIds: Set<number>
): DailyQuestionFull | null {
  const eligiblePlayers = data.players.filter(
    (p) => p.position && POSITION_LABEL[p.position] && !excludePlayerIds.has(p.id)
  );
  if (eligiblePlayers.length === 0) return null;

  const player = seededShuffle(eligiblePlayers, `${seedStr}-player`)[0];
  excludePlayerIds.add(player.id);
  const correctLabel = POSITION_LABEL[player.position!];
  // Toujours exactement 3 décoys : POSITION_LABEL n'a que 4 valeurs possibles au total.
  const decoyLabels = Object.values(POSITION_LABEL).filter((l) => l !== correctLabel);
  const choices = seededShuffle([correctLabel, ...decoyLabels], `${seedStr}-order`);
  const correctIndex = choices.indexOf(correctLabel);
  const team = data.teams.find((t) => t.id === player.team_id);

  return {
    position,
    category: "guess_player_position",
    difficulty: "easy",
    question: `Quel est le poste de ${player.name}${team ? ` (${team.name})` : ""} ?`,
    teamLogoUrl: player.photo_url,
    choices,
    correctIndex,
    explanation: `${player.name} évolue au poste de ${correctLabel.toLowerCase()}.`,
  };
}

/** "Qui est l'actuel meilleur buteur de ce championnat ?" — agrégé depuis les vrais buts déjà
 * enregistrés cette saison (match_goals). Décoys : les buteurs suivants au classement, plus
 * crédibles que des noms au hasard. */
function genLeagueTopScorer(
  data: LeagueData,
  matches: MatchRow[],
  goals: GoalRow[],
  position: number,
  seedStr: string,
  excludeLeagueIds: Set<number>
): DailyQuestionFull | null {
  const leagueIdByMatchId = new Map(matches.map((m) => [m.id, m.league_id]));
  const goalsByLeagueAndPlayer = new Map<number, Map<number, number>>();
  for (const g of goals) {
    if (g.player_id == null) continue;
    const leagueId = leagueIdByMatchId.get(g.match_id);
    if (leagueId == null) continue;
    if (!goalsByLeagueAndPlayer.has(leagueId)) goalsByLeagueAndPlayer.set(leagueId, new Map());
    const perPlayer = goalsByLeagueAndPlayer.get(leagueId)!;
    perPlayer.set(g.player_id, (perPlayer.get(g.player_id) ?? 0) + 1);
  }

  // >= 4 buteurs distincts : il faut de quoi fournir 3 décoys en plus du bon buteur.
  const eligibleLeagueIds = [...goalsByLeagueAndPlayer.keys()].filter(
    (id) => !excludeLeagueIds.has(id) && goalsByLeagueAndPlayer.get(id)!.size >= 4
  );
  if (eligibleLeagueIds.length === 0) return null;

  const leagueId = seededShuffle(eligibleLeagueIds, `${seedStr}-league`)[0];
  excludeLeagueIds.add(leagueId);
  const leagueName = data.leagueNameById.get(leagueId);
  if (!leagueName) return null;

  const ranked = [...goalsByLeagueAndPlayer.get(leagueId)!.entries()].sort((a, b) => b[1] - a[1]);
  const topCount = ranked[0][1];
  // Égalité en tête : très courante tôt dans la saison (peu de journées jouées, beaucoup de
  // joueurs à 2-3 buts) — exiger un meilleur buteur unique ferait échouer ce type de question
  // presque tout le temps. On désigne un des co-leaders (choix stable via la seed) comme bonne
  // réponse, et on exclut TOUS les co-leaders des décoys : un décoy doit avoir strictement moins
  // de buts, sans quoi il serait tout aussi "correct" que la réponse retenue.
  const topScorerIds = ranked.filter(([, count]) => count === topCount).map(([id]) => id);
  const topPlayerId = seededShuffle(topScorerIds, `${seedStr}-tie-break`)[0];
  const topPlayer = data.players.find((p) => p.id === topPlayerId);
  if (!topPlayer) return null;

  const decoyPlayers = ranked
    .filter(([, count]) => count < topCount)
    .slice(0, 3)
    .map(([id]) => data.players.find((p) => p.id === id))
    .filter((p): p is PlayerLite => !!p);
  if (decoyPlayers.length < 3) return null;

  const choiceObjs = seededShuffle([topPlayer, ...decoyPlayers], `${seedStr}-order`);
  const correctIndex = choiceObjs.findIndex((p) => p.id === topPlayer.id);
  const tied = topScorerIds.length > 1;

  return {
    position,
    category: "league_top_scorer",
    difficulty: "hard",
    question: tied
      ? `Qui fait partie des meilleurs buteurs actuels de ${leagueName} cette saison ?`
      : `Qui est l'actuel meilleur buteur de ${leagueName} cette saison ?`,
    teamLogoUrl: null,
    choices: choiceObjs.map((p) => p.name),
    correctIndex,
    explanation: tied
      ? `${topPlayer.name} co-domine le classement avec ${topCount} buts.`
      : `${topPlayer.name} est en tête avec ${topCount} but${topCount > 1 ? "s" : ""}.`,
  };
}

/** "Qui a marqué pour cette équipe dans ce match ?" — uniquement pour un match où l'équipe visée
 * n'a marqué qu'une seule fois, sans quoi plusieurs réponses seraient valables. */
function genGuessMatchScorer(
  data: LeagueData,
  matches: MatchRow[],
  goals: GoalRow[],
  teamsById: Map<number, TeamLite>,
  position: number,
  seedStr: string,
  excludeGoalKeys: Set<string>
): DailyQuestionFull | null {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const goalCountByTeamMatch = new Map<string, number>();
  for (const g of goals) {
    if (g.player_id == null) continue;
    const key = `${g.match_id}:${g.team_id}`;
    goalCountByTeamMatch.set(key, (goalCountByTeamMatch.get(key) ?? 0) + 1);
  }

  const eligibleGoals = goals.filter((g) => {
    if (g.player_id == null) return false;
    if (excludeGoalKeys.has(`${g.match_id}:${g.player_id}`)) return false;
    if ((goalCountByTeamMatch.get(`${g.match_id}:${g.team_id}`) ?? 0) !== 1) return false;
    if (!matchById.has(g.match_id)) return false;
    return (data.playersByTeam.get(g.team_id)?.length ?? 0) >= 4;
  });
  if (eligibleGoals.length === 0) return null;

  const goal = seededShuffle(eligibleGoals, `${seedStr}-goal`)[0];
  excludeGoalKeys.add(`${goal.match_id}:${goal.player_id}`);
  const match = matchById.get(goal.match_id)!;
  const scorer = data.players.find((p) => p.id === goal.player_id);
  const home = teamsById.get(match.home_team_id);
  const away = teamsById.get(match.away_team_id);
  const scoringTeam = teamsById.get(goal.team_id);
  if (!scorer || !home || !away || !scoringTeam) return null;

  const teammates = (data.playersByTeam.get(goal.team_id) ?? []).filter((p) => p.id !== scorer.id);
  const decoys = seededShuffle(teammates, `${seedStr}-decoys`).slice(0, 3);
  if (decoys.length < 3) return null;

  const choiceObjs = seededShuffle([{ id: scorer.id, name: scorer.name }, ...decoys], `${seedStr}-order`);
  const correctIndex = choiceObjs.findIndex((c) => c.id === scorer.id);

  return {
    position,
    category: "guess_match_scorer",
    difficulty: "medium",
    question: `Qui a marqué pour ${scoringTeam.name} lors du match ${home.name} ${match.home_score}-${match.away_score} ${away.name} ?`,
    teamLogoUrl: scoringTeam.logo_url,
    choices: choiceObjs.map((c) => c.name),
    correctIndex,
    explanation: `${scorer.name} est l'auteur de ce but pour ${scoringTeam.name}.`,
  };
}

type DynamicType =
  | "hidden_teammate"
  | "guess_crest"
  | "guess_player_team"
  | "guess_match_score"
  | "guess_player_position"
  | "league_top_scorer"
  | "guess_match_scorer";
const ALL_DYNAMIC_TYPES: DynamicType[] = [
  "hidden_teammate",
  "guess_crest",
  "guess_player_team",
  "guess_match_score",
  "guess_player_position",
  "league_top_scorer",
  "guess_match_scorer",
];

// Composition du "sac" de types dynamiques : mélangé différemment chaque jour et distribué aux 7
// positions dynamiques. Un de chaque type désormais (7 types pour 7 créneaux) : le fallback
// ci-dessous couvre les jours où un type précis n'a pas assez de données (ex: league_top_scorer
// tôt en saison), donc pas besoin de doubler les types les plus fiables pour "assurer le coup".
const DYNAMIC_TYPE_POOL: DynamicType[] = [
  "guess_crest",
  "guess_player_team",
  "guess_match_score",
  "hidden_teammate",
  "guess_player_position",
  "league_top_scorer",
  "guess_match_scorer",
];

interface DynamicRow {
  position: number;
  category: string;
  difficulty: string;
  question: string;
  team_logo_url: string | null;
  choices: unknown;
  correct_index: number;
  explanation: string | null;
}

function rowToQuestion(row: DynamicRow): DailyQuestionFull {
  return {
    position: row.position,
    category: row.category as QuizCategory,
    difficulty: row.difficulty as QuizDifficulty,
    question: row.question,
    teamLogoUrl: row.team_logo_url,
    choices: row.choices as unknown as string[],
    correctIndex: row.correct_index,
    explanation: row.explanation,
  };
}

/** Génère (une seule fois par date) puis fige en base les questions dynamiques du jour, pour que
 * l'affichage et la validation d'une réponse lisent toujours la même version — voir migration
 * 0025_quiz_daily_dynamic_cache pour le pourquoi. */
async function getOrGenerateDynamicQuestions(
  supabase: ServiceClient,
  quizDate: string,
  dynamicPositions: number[]
): Promise<Map<number, DailyQuestionFull>> {
  if (dynamicPositions.length === 0) return new Map();

  const { data: cached } = await supabase
    .from("quiz_daily_dynamic")
    .select("position, category, difficulty, question, team_logo_url, choices, correct_index, explanation")
    .eq("quiz_date", quizDate);

  // >0 et non >= dynamicPositions.length : si un slot échoue à se générer (pas assez de matchs/
  // joueurs éligibles ce jour-là), la génération reste figée telle quelle pour le reste de la
  // journée plutôt que de réessayer à chaque appel. Sinon, une régénération partielle peut piocher
  // dans des données qui ont changé entre-temps (sync-fixtures tourne désormais toutes les 30 min)
  // et produire un tirage différent de celui déjà affiché à quelqu'un en train de répondre — la
  // "bonne réponse" mise en avant ne correspondrait alors plus à la question qu'il a vue.
  if (cached && cached.length > 0) {
    return new Map((cached as DynamicRow[]).map((r) => [r.position, rowToQuestion(r)]));
  }

  const leagueData = await fetchLeagueData(supabase);
  const matches = await fetchFinishedMatches(supabase, leagueData.leagueIds, quizDate);
  const goals = await fetchGoalsForMatches(
    supabase,
    matches.map((m) => m.id)
  );
  const teamsById = new Map(leagueData.teams.map((t) => [t.id, t]));
  const typeOrder = seededShuffle(DYNAMIC_TYPE_POOL, `${quizDate}-dynamic-order`);

  // Un même type peut tomber sur plusieurs positions le même jour (fallback compris, si un autre
  // type échoue) : ces ensembles, partagés entre les appels, empêchent deux positions du même type
  // de retomber sur la même équipe/joueur/match/championnat ce jour-là.
  const usedTeamIdsForCrest = new Set<number>();
  const usedTeamIdsForHiddenTeammate = new Set<number>();
  const usedPlayerIdsForPlayerTeam = new Set<number>();
  const usedMatchIds = new Set<number>();
  const usedPlayerIdsForPosition = new Set<number>();
  const usedLeagueIdsForTopScorer = new Set<number>();
  const usedGoalKeysForMatchScorer = new Set<string>();

  const generateByType = (type: DynamicType, position: number, seedStr: string): DailyQuestionFull | null => {
    switch (type) {
      case "hidden_teammate":
        return genHiddenTeammate(leagueData, position, seedStr, usedTeamIdsForHiddenTeammate);
      case "guess_crest":
        return genGuessCrest(leagueData, position, seedStr, usedTeamIdsForCrest);
      case "guess_player_team":
        return genGuessPlayerTeam(leagueData, position, seedStr, usedPlayerIdsForPlayerTeam);
      case "guess_match_score":
        return genGuessMatchScore(matches, teamsById, position, seedStr, usedMatchIds);
      case "guess_player_position":
        return genGuessPlayerPosition(leagueData, position, seedStr, usedPlayerIdsForPosition);
      case "league_top_scorer":
        return genLeagueTopScorer(leagueData, matches, goals, position, seedStr, usedLeagueIdsForTopScorer);
      case "guess_match_scorer":
        return genGuessMatchScorer(leagueData, matches, goals, teamsById, position, seedStr, usedGoalKeysForMatchScorer);
    }
  };

  // Un type peut échouer à produire une question ce jour-là (ex: aucun match terminé en tout début
  // de saison, pour "guess_match_score") sans que les données manquent pour autant globalement :
  // plutôt que de laisser le créneau vide — ce qui réduit le quiz du jour en dessous de 10
  // questions, À VIE pour cette date puisque le résultat est mis en cache (voir plus bas) — on
  // essaie les 3 autres types avant d'abandonner ce créneau. Vu en prod : un quiz coincé à
  // seulement 3 questions (les statiques) alors que les données existaient, juste pas pour le type
  // tiré au hasard sur ce créneau précis.
  //
  // usedTypes, partagé entre toutes les positions de cette génération : un type dont le texte de
  // question ne varie pas selon l'entité tirée (ex: guess_crest, toujours "Quel club est représenté
  // par ce blason ?") produirait deux questions visuellement identiques (même texte, bonne réponse
  // différente) si son repli était choisi deux fois le même jour — les ensembles
  // usedTeamIdsForCrest etc. empêchent déjà de retirer la MÊME équipe/joueur/match, mais pas de
  // retomber sur le MÊME TYPE avec une entité différente. Les types jamais encore utilisés sont
  // donc essayés avant ceux déjà pris, un repli sur un type déjà utilisé restant préférable à un
  // créneau vide si vraiment aucun type frais ne peut être satisfait ce jour-là.
  const usedTypes = new Set<DynamicType>();
  const generated = dynamicPositions
    .map((position, idx) => {
      const primaryType = typeOrder[idx % typeOrder.length];
      const seedStr = `${quizDate}-${position}`;
      const remainingTypes = ALL_DYNAMIC_TYPES.filter((t) => t !== primaryType);
      const freshFallbacks = seededShuffle(
        remainingTypes.filter((t) => !usedTypes.has(t)),
        `${seedStr}-fallback-fresh`
      );
      const repeatFallbacks = seededShuffle(
        remainingTypes.filter((t) => usedTypes.has(t)),
        `${seedStr}-fallback-repeat`
      );
      for (const type of [primaryType, ...freshFallbacks, ...repeatFallbacks]) {
        const question = generateByType(type, position, seedStr);
        if (question) {
          usedTypes.add(type);
          return question;
        }
      }
      return null;
    })
    .filter((q): q is DailyQuestionFull => q !== null);

  if (generated.length === 0) return new Map();

  // INSERT brut (pas upsert+ignoreDuplicates) : un lot multi-lignes est une seule instruction
  // atomique en PostgreSQL — tout le tirage du jour passe, ou rien. Avec l'ancien upsert (résolu
  // ligne par ligne), deux requêtes qui génèrent en même temps (première visite du jour) pouvaient
  // chacune "gagner" sur des POSITIONS différentes : chaque tirage évite bien les répétitions en
  // interne (les ensembles usedTeamIdsForCrest etc. ci-dessus), mais deux tirages indépendants ne se
  // coordonnent pas entre eux — le résultat mélangé pouvait afficher la même question deux fois le
  // même jour (ex: "Quel club est représenté par ce blason ?" ou le même match), chacune avec une
  // bonne réponse différente. Confirmé en base sur 8 des 10 derniers jours. Avec un insert atomique,
  // le perdant de la course abandonne entièrement son propre tirage (erreur 23505 ci-dessous) et
  // relit celui du gagnant plus bas, jamais un mélange des deux.
  // Une erreur ici (23505 = quelqu'un d'autre a gagné la course entre notre lecture de `cached`
  // plus haut et cet insert, ou autre chose) reste silencieuse — comportement préexistant, jamais
  // vérifié côté appelant — on relit simplement l'état actuel de la table ci-dessous, qui reflète
  // soit notre propre insert (gagné), soit celui du gagnant (perdu), jamais un mélange des deux.
  await supabase.from("quiz_daily_dynamic").insert(
    generated.map((q) => ({
      quiz_date: quizDate,
      position: q.position,
      category: q.category,
      difficulty: q.difficulty,
      question: q.question,
      team_logo_url: q.teamLogoUrl ?? null,
      choices: q.choices,
      correct_index: q.correctIndex,
      explanation: q.explanation,
    }))
  );

  const { data: finalRows } = await supabase
    .from("quiz_daily_dynamic")
    .select("position, category, difficulty, question, team_logo_url, choices, correct_index, explanation")
    .eq("quiz_date", quizDate);

  return new Map((finalRows as DynamicRow[] | null ?? []).map((r) => [r.position, rowToQuestion(r)]));
}

/** Les 10 questions du jour, complètes (avec la bonne réponse) — usage serveur uniquement. */
export async function getDailyQuiz(supabase: ServiceClient, quizDate: string): Promise<DailyQuestionFull[]> {
  const dynamicPositions = SLOT_PLAN.map((slot, i) => (slot.kind === "dynamic" ? i : -1)).filter((i) => i >= 0);

  // Indépendantes l'une de l'autre : lancées en parallèle plutôt qu'en série pour ne pas doubler
  // la latence à chaque soumission de réponse (ce chemin est appelé sur chaque tap, pas qu'au
  // premier chargement de la page).
  const [staticByPosition, dynamicByPosition] = await Promise.all([
    pickStaticQuestions(supabase, quizDate),
    getOrGenerateDynamicQuestions(supabase, quizDate, dynamicPositions),
  ]);

  const questions: DailyQuestionFull[] = [];
  for (let position = 0; position < SLOT_PLAN.length; position++) {
    const q = dynamicByPosition.get(position) ?? staticByPosition.get(position);
    if (q) questions.push(q);
  }
  return questions;
}
