import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type QuizCategory = "score" | "player_career" | "trivia" | "vintage_jersey" | "hidden_teammate";
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

// Ordre fixe des 10 questions du jour : facile en ouverture, montée en difficulté, questions
// "coéquipier caché" (générées à partir de l'effectif réel) réparties entre les deux.
const SLOT_PLAN: Array<{ kind: "static"; difficulty: QuizDifficulty } | { kind: "dynamic" }> = [
  { kind: "static", difficulty: "easy" },
  { kind: "static", difficulty: "easy" },
  { kind: "dynamic" },
  { kind: "static", difficulty: "medium" },
  { kind: "dynamic" },
  { kind: "static", difficulty: "medium" },
  { kind: "static", difficulty: "hard" },
  { kind: "static", difficulty: "hard" },
  { kind: "dynamic" },
  { kind: "static", difficulty: "hard" },
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
  // .order("id") pour la même raison que dans generateHiddenTeammateQuestion : garantir un
  // ordre stable d'un appel à l'autre avant le mélange déterministe.
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

/** "Ces 3 joueurs jouent dans la même équipe, qui est le 4e ?" — généré depuis les vrais effectifs. */
async function generateHiddenTeammateQuestion(
  supabase: ServiceClient,
  position: number,
  seedStr: string
): Promise<DailyQuestionFull | null> {
  const { data: leagues } = await supabase.from("leagues").select("id").eq("active", true);
  const leagueIds = (leagues ?? []).map((l) => l.id);
  if (leagueIds.length === 0) return null;

  // .order("id") est indispensable : sans ordre explicite, Postgres peut renvoyer les lignes
  // dans un ordre différent d'un appel à l'autre, ce qui casserait le mélange déterministe (la
  // page afficherait une équipe et la validation serveur en recalculerait une autre).
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, logo_url")
    .in("league_id", leagueIds)
    .order("id", { ascending: true });
  const { data: players } = await supabase
    .from("players")
    .select("id, name, team_id")
    .in(
      "team_id",
      (teams ?? []).map((t) => t.id)
    )
    .order("id", { ascending: true });

  const playersByTeam = new Map<number, Array<{ id: number; name: string }>>();
  for (const p of players ?? []) {
    if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
    playersByTeam.get(p.team_id)!.push({ id: p.id, name: p.name });
  }

  const eligibleTeams = (teams ?? []).filter((t) => (playersByTeam.get(t.id)?.length ?? 0) >= 4);
  if (eligibleTeams.length === 0) return null;

  const team = seededShuffle(eligibleTeams, `${seedStr}-team`)[0];
  const teamPlayers = seededShuffle(playersByTeam.get(team.id)!, `${seedStr}-squad`);
  const [p1, p2, p3, hidden] = teamPlayers;

  const otherPlayers = (players ?? []).filter((p) => p.team_id !== team.id);
  const decoys = seededShuffle(otherPlayers, `${seedStr}-decoys`)
    .filter((p) => p.name !== hidden.name)
    .slice(0, 3);

  const choiceObjs = seededShuffle([hidden, ...decoys], `${seedStr}-order`);
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

/** Les 10 questions du jour, complètes (avec la bonne réponse) — usage serveur uniquement. */
export async function getDailyQuiz(supabase: ServiceClient, quizDate: string): Promise<DailyQuestionFull[]> {
  const staticByPosition = await pickStaticQuestions(supabase, quizDate);

  const dynamicPositions = SLOT_PLAN.map((slot, i) => (slot.kind === "dynamic" ? i : -1)).filter((i) => i >= 0);
  const dynamicQuestions = await Promise.all(
    dynamicPositions.map((position) => generateHiddenTeammateQuestion(supabase, position, `${quizDate}-${position}`))
  );

  const questions: DailyQuestionFull[] = [];
  for (let position = 0; position < SLOT_PLAN.length; position++) {
    const dynamicIndex = dynamicPositions.indexOf(position);
    const q = dynamicIndex >= 0 ? dynamicQuestions[dynamicIndex] : staticByPosition.get(position);
    if (q) questions.push(q);
  }
  return questions;
}
