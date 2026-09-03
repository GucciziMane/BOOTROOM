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
  | "guess_match_score";
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

interface PlayerLite {
  id: number;
  name: string;
  team_id: number;
  photo_url: string | null;
}

interface LeagueData {
  leagueIds: number[];
  teams: TeamLite[];
  players: PlayerLite[];
  playersByTeam: Map<number, Array<{ id: number; name: string }>>;
}

interface MatchRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  matchday: number | null;
}

/** Charge une seule fois les données réelles (effectifs, blasons) utilisées par tous les générateurs dynamiques. */
async function fetchLeagueData(supabase: ServiceClient): Promise<LeagueData> {
  const { data: leagues } = await supabase.from("leagues").select("id").eq("active", true);
  const leagueIds = (leagues ?? []).map((l) => l.id);
  if (leagueIds.length === 0) return { leagueIds: [], teams: [], players: [], playersByTeam: new Map() };

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
    .select("id, name, team_id, photo_url")
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

  return { leagueIds, teams: teams ?? [], players: players ?? [], playersByTeam };
}

/** Matchs terminés avant le jour du quiz — la borne évite qu'un match en cours ne change de statut
 * pendant que quelqu'un répond, ce qui ferait diverger l'affichage et la validation serveur. */
async function fetchFinishedMatches(supabase: ServiceClient, leagueIds: number[], quizDate: string): Promise<MatchRow[]> {
  if (leagueIds.length === 0) return [];
  const { data } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, away_score, matchday")
    .in("league_id", leagueIds)
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .lt("kickoff_at", `${quizDate}T00:00:00Z`)
    .order("id", { ascending: true });
  return (data ?? []) as MatchRow[];
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

type DynamicType = "hidden_teammate" | "guess_crest" | "guess_player_team" | "guess_match_score";

// Composition du "sac" de types dynamiques : mélangé différemment chaque jour et distribué aux 7
// positions dynamiques, ce qui garantit un mélange varié tous les jours sans jamais faire reposer
// la majorité du quiz sur le "coéquipier caché" (1 occurrence sur 7 ici, contre les autres x2).
const DYNAMIC_TYPE_POOL: DynamicType[] = [
  "guess_crest",
  "guess_crest",
  "guess_player_team",
  "guess_player_team",
  "guess_match_score",
  "guess_match_score",
  "hidden_teammate",
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

  if (cached && cached.length >= dynamicPositions.length) {
    return new Map((cached as DynamicRow[]).map((r) => [r.position, rowToQuestion(r)]));
  }

  const leagueData = await fetchLeagueData(supabase);
  const matches = await fetchFinishedMatches(supabase, leagueData.leagueIds, quizDate);
  const teamsById = new Map(leagueData.teams.map((t) => [t.id, t]));
  const typeOrder = seededShuffle(DYNAMIC_TYPE_POOL, `${quizDate}-dynamic-order`);

  // Un même type peut tomber sur plusieurs positions le même jour (le sac en contient 2 pour
  // crest/player-team/match-score) : ces ensembles, partagés entre les appels, empêchent deux
  // positions du même type de retomber sur la même équipe/joueur/match ce jour-là.
  const usedTeamIdsForCrest = new Set<number>();
  const usedTeamIdsForHiddenTeammate = new Set<number>();
  const usedPlayerIdsForPlayerTeam = new Set<number>();
  const usedMatchIds = new Set<number>();

  const generated = dynamicPositions
    .map((position, idx) => {
      const type = typeOrder[idx % typeOrder.length];
      const seedStr = `${quizDate}-${position}`;
      switch (type) {
        case "hidden_teammate":
          return genHiddenTeammate(leagueData, position, seedStr, usedTeamIdsForHiddenTeammate);
        case "guess_crest":
          return genGuessCrest(leagueData, position, seedStr, usedTeamIdsForCrest);
        case "guess_player_team":
          return genGuessPlayerTeam(leagueData, position, seedStr, usedPlayerIdsForPlayerTeam);
        case "guess_match_score":
          return genGuessMatchScore(matches, teamsById, position, seedStr, usedMatchIds);
      }
    })
    .filter((q): q is DailyQuestionFull => q !== null);

  if (generated.length === 0) return new Map();

  // upsert + ignoreDuplicates : si deux requêtes génèrent en même temps (première visite du jour),
  // la base ne garde que la première version insérée pour chaque position — on relit ensuite pour
  // que tout le monde converge sur cette version-là, y compris le processus qui a "perdu" la course.
  await supabase.from("quiz_daily_dynamic").upsert(
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
    })),
    { onConflict: "quiz_date,position", ignoreDuplicates: true }
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
