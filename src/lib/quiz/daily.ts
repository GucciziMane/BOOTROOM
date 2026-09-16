import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// Quiz 100% statique (banque écrite à la main, voir supabase/migrations/0057_quiz_static_rebuild) —
// plus aucune question générée depuis les données en direct (effectifs, blasons, scores). Cette
// génération dynamique a été la source d'une longue série de bugs en prod (question affichée
// différente de celle validée côté serveur, doublons de noms parmi les choix, effectifs figés/
// obsolètes...) — voir l'historique de src/app/api/cron/sync-teams-players/route.ts et les
// nombreux correctifs successifs de ce fichier avant le 15/09/2026. Une banque statique ne peut
// structurellement plus diverger entre l'affichage et la validation : la question du jour est
// entièrement déterminée par (date, banque), jamais recalculée depuis un état qui peut changer
// entre deux appels.
export type QuizCategory = "score" | "player_career" | "trivia" | "vintage_jersey";
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

// Le quiz change de jour à 1h du matin (Europe/Paris) plutôt qu'à minuit pile : demandé pour
// laisser une vraie marge après minuit (ex: deux joueurs en train de terminer le quiz ensemble
// juste après le changement de jour) plutôt qu'un nouveau quiz qui apparaît en pleine partie.
// N'affecte QUE le quiz — parisDateString reste inchangée pour tout le reste de l'appli (ex:
// middleware.ts, redirection "première visite du jour"), qui continue de basculer à minuit pile.
const QUIZ_DAY_OFFSET_MS = 60 * 60 * 1000;

/** Comme parisDateString, mais le "jour" du quiz commence à 1h du matin (Europe/Paris), pas minuit. */
export function quizDayString(date: Date = new Date()): string {
  return parisDateString(new Date(date.getTime() - QUIZ_DAY_OFFSET_MS));
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

// Ordre fixe des 10 questions du jour, toutes issues de la banque écrite à la main — une courbe de
// difficulté croissante (3 faciles, 4 moyennes, 3 difficiles) plutôt qu'un mélange homogène.
const SLOT_PLAN: QuizDifficulty[] = [
  "easy",
  "easy",
  "easy",
  "medium",
  "medium",
  "medium",
  "medium",
  "hard",
  "hard",
  "hard",
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

// La banque a été écrite à la main choix par choix, sans se soucier de varier la position de la
// bonne réponse (beaucoup de questions l'ont en position 0) — sans ce mélange, un joueur assidu
// finit par remarquer le motif et répondre sans même lire la question. Mélange déterministe par
// (jour, position, joueur) : chacun voit un ordre différent, mais le même ordre à chaque relecture
// de la question (affichage ET validation lisent ce même mélange, aucun état à faire diverger).
function shuffleChoicesForUser(row: QuestionRow, position: number, seedStr: string): DailyQuestionFull {
  const choices = row.choices as string[];
  const order = seededShuffle(
    choices.map((_, i) => i),
    seedStr
  );
  return {
    position,
    category: row.category as QuizCategory,
    difficulty: row.difficulty as QuizDifficulty,
    question: row.question,
    choices: order.map((i) => choices[i]),
    correctIndex: order.indexOf(row.correct_index),
    explanation: row.explanation,
  };
}

/** Les 10 questions du jour, complètes (avec la bonne réponse) — usage serveur uniquement.
 *
 * Rotation déterministe par curseur (pas de tirage aléatoire à chaque appel) : pour une difficulté
 * donnée, le jour N avance dans un ordre mélangé une seule fois (seededShuffle, jamais rebrassé) de
 * `slotsPerDay` crans — garantit qu'aucune question ne revient avant d'avoir fait un tour complet
 * de la banque pour sa difficulté, et que affichage/validation lisent toujours EXACTEMENT la même
 * chose pour une date donnée (aucun état mutable, aucune génération, rien qui puisse diverger entre
 * deux appels le même jour). */
export async function getDailyQuiz(supabase: ServiceClient, quizDate: string, userId: string): Promise<DailyQuestionFull[]> {
  // .order("id") : garantit un ordre stable d'un appel à l'autre avant le mélange déterministe.
  const { data: rows } = await supabase
    .from("quiz_questions")
    .select("id, category, difficulty, question, choices, correct_index, explanation")
    .eq("active", true)
    .order("id", { ascending: true });

  const byDifficulty: Record<QuizDifficulty, QuestionRow[]> = { easy: [], medium: [], hard: [] };
  for (const r of (rows ?? []) as QuestionRow[]) byDifficulty[r.difficulty as QuizDifficulty]?.push(r);

  // Ordre stable (mélangé une seule fois, jamais reshuffle) : la rotation par jour se fait en
  // avançant un curseur dans cet ordre fixe, garantissant l'absence de répétition avant un tour complet.
  const order: Record<QuizDifficulty, QuestionRow[]> = {
    easy: seededShuffle(byDifficulty.easy, "quiz-bank-easy"),
    medium: seededShuffle(byDifficulty.medium, "quiz-bank-medium"),
    hard: seededShuffle(byDifficulty.hard, "quiz-bank-hard"),
  };

  const slotsPerDay: Record<QuizDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const difficulty of SLOT_PLAN) slotsPerDay[difficulty]++;

  const day = dayIndex(quizDate);
  const cursorWithinDay: Record<QuizDifficulty, number> = { easy: 0, medium: 0, hard: 0 };

  const questions: (DailyQuestionFull | undefined)[] = SLOT_PLAN.map((difficulty, position) => {
    const bucket = order[difficulty];
    if (!bucket || bucket.length === 0) return undefined;
    const globalIndex = day * slotsPerDay[difficulty] + cursorWithinDay[difficulty];
    cursorWithinDay[difficulty]++;
    const row = bucket[mod(globalIndex, bucket.length)];
    return shuffleChoicesForUser(row, position, `${quizDate}:${userId}:${position}`);
  });

  return questions.filter((q): q is DailyQuestionFull => q !== undefined);
}
