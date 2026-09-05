"use server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDailyQuiz, parisDateString } from "@/lib/quiz/daily";

export interface SubmitAnswerResult {
  error: string | null;
  isCorrect?: boolean;
  correctIndex?: number;
  explanation?: string | null;
  points?: number;
  streakAfter?: number;
  finalScore?: number | null;
}

/** Revalide indépendamment côté serveur (le client n'envoie que sa réponse, jamais la question). */
export async function submitQuizAnswer(position: number, choiceIndex: number): Promise<SubmitAnswerResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  const admin = createServiceRoleClient();
  const quizDate = parisDateString();

  // Le quiz du jour et les réponses déjà données sont indépendants l'un de l'autre : lancés en
  // parallèle plutôt qu'en série pour réduire la latence perçue à chaque tap (c'était jusqu'à 5-6
  // aller-retours Supabase séquentiels, sensible sur mobile).
  const [quiz, { data: priorAnswers }] = await Promise.all([
    getDailyQuiz(admin, quizDate),
    admin
      .from("quiz_answers")
      .select("is_correct, points")
      .eq("user_id", user.id)
      .eq("quiz_date", quizDate)
      .order("position", { ascending: true }),
  ]);

  const answered = priorAnswers ?? [];
  if (answered.length !== position) {
    return { error: "Question déjà répondue ou hors séquence." };
  }

  const question = quiz[position];
  if (!question) return { error: "Question introuvable." };

  let streak = 0;
  for (const a of answered) {
    if (a.is_correct) streak++;
    else streak = 0;
  }

  const isCorrect = choiceIndex === question.correctIndex;
  const streakAfter = isCorrect ? streak + 1 : 0;
  const points = isCorrect ? (streakAfter >= 3 ? 2 : 1) : 0;

  const { error } = await admin.from("quiz_answers").insert({
    user_id: user.id,
    quiz_date: quizDate,
    position,
    choice_index: choiceIndex,
    is_correct: isCorrect,
    points,
  });
  if (error) {
    // 23505 = violation de la contrainte unique (user_id, quiz_date, position) : un double envoi
    // réseau (retry, double-tap) a déjà inséré cette réponse avant celui-ci. On renvoie le résultat
    // déjà enregistré plutôt que l'erreur Postgres brute, pour que le double envoi soit sans effet
    // visible côté joueur au lieu de casser l'affichage.
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("quiz_answers")
        .select("is_correct, points")
        .eq("user_id", user.id)
        .eq("quiz_date", quizDate)
        .eq("position", position)
        .maybeSingle();
      if (existing) {
        return {
          error: null,
          isCorrect: existing.is_correct,
          correctIndex: question.correctIndex,
          explanation: question.explanation,
          points: existing.points,
          streakAfter: existing.is_correct ? streak + 1 : 0,
          finalScore: null,
        };
      }
    }
    return { error: error.message };
  }

  // quiz.length et non 10 en dur : un jour où une question dynamique n'a pas pu être générée (pas
  // assez de matchs/joueurs éligibles), le quiz du jour compte moins de 10 questions — sans ça,
  // personne ne pourrait jamais l'y terminer ni apparaître au classement de ce jour-là.
  let finalScore: number | null = null;
  if (position === quiz.length - 1) {
    // Pas besoin de relire quiz_answers : `answered` (positions précédentes) + la réponse qu'on
    // vient d'insérer couvrent déjà toutes les questions du jour.
    const totalPoints = answered.reduce((sum, a) => sum + a.points, 0) + points;
    const correctCount = answered.filter((a) => a.is_correct).length + (isCorrect ? 1 : 0);
    const bonus = correctCount === quiz.length ? 3 : 0;
    finalScore = totalPoints + bonus;

    await admin
      .from("quiz_results")
      .upsert(
        { user_id: user.id, quiz_date: quizDate, score: finalScore, correct_count: correctCount },
        { onConflict: "user_id,quiz_date" }
      );
  }

  return {
    error: null,
    isCorrect,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    points,
    streakAfter,
    finalScore,
  };
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  avatarUrl: string | null;
  score: number;
  correctCount: number;
}

export async function getQuizLeaderboard(): Promise<LeaderboardRow[]> {
  const admin = createServiceRoleClient();
  const quizDate = parisDateString();

  const { data: results } = await admin
    .from("quiz_results")
    .select("user_id, score, correct_count")
    .eq("quiz_date", quizDate)
    .order("score", { ascending: false });

  if (!results || results.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, avatar_url")
    .in(
      "id",
      results.map((r) => r.user_id)
    );
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return results.map((r) => ({
    userId: r.user_id,
    username: profileById.get(r.user_id)?.username ?? "?",
    avatarUrl: profileById.get(r.user_id)?.avatar_url ?? null,
    score: r.score,
    correctCount: r.correct_count,
  }));
}

export interface SeasonLeaderboardRow {
  userId: string;
  username: string;
  avatarUrl: string | null;
  totalScore: number;
  daysPlayed: number;
}

/** Cumul de tous les scores quotidiens depuis le début, pour départager un vainqueur en fin de saison. */
export async function getQuizSeasonLeaderboard(): Promise<SeasonLeaderboardRow[]> {
  const admin = createServiceRoleClient();

  const { data: results } = await admin.from("quiz_results").select("user_id, score");
  if (!results || results.length === 0) return [];

  const totals = new Map<string, { total: number; days: number }>();
  for (const r of results) {
    const cur = totals.get(r.user_id) ?? { total: 0, days: 0 };
    cur.total += r.score;
    cur.days += 1;
    totals.set(r.user_id, cur);
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, avatar_url")
    .in("id", [...totals.keys()]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return [...totals.entries()]
    .map(([userId, t]) => ({
      userId,
      username: profileById.get(userId)?.username ?? "?",
      avatarUrl: profileById.get(userId)?.avatar_url ?? null,
      totalScore: t.total,
      daysPlayed: t.days,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
}
