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

  const { count: answeredCount } = await admin
    .from("quiz_answers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("quiz_date", quizDate);

  if ((answeredCount ?? 0) !== position) {
    return { error: "Question déjà répondue ou hors séquence." };
  }

  const quiz = await getDailyQuiz(admin, quizDate);
  const question = quiz[position];
  if (!question) return { error: "Question introuvable." };

  const { data: priorAnswers } = await admin
    .from("quiz_answers")
    .select("is_correct")
    .eq("user_id", user.id)
    .eq("quiz_date", quizDate)
    .order("position", { ascending: true });

  let streak = 0;
  for (const a of priorAnswers ?? []) {
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
  if (error) return { error: error.message };

  let finalScore: number | null = null;
  if (position === 9) {
    const { data: allAnswers } = await admin
      .from("quiz_answers")
      .select("points, is_correct")
      .eq("user_id", user.id)
      .eq("quiz_date", quizDate);
    const totalPoints = (allAnswers ?? []).reduce((sum, a) => sum + a.points, 0);
    const correctCount = (allAnswers ?? []).filter((a) => a.is_correct).length;
    const bonus = correctCount === 10 ? 3 : 0;
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
