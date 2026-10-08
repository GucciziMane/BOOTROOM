"use server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export interface SubmitSpecialQuizAnswerResult {
  error: string | null;
  isCorrect?: boolean;
  correctIndex?: number;
  explanation?: string | null;
  points?: number;
  streakAfter?: number;
  finalScore?: number | null;
}

// Sentinelle de date fixe, jamais un vrai "aujourd'hui" passé ou futur : antérieure à EPOCH
// (2026-01-01, voir src/lib/quiz/daily.ts), le premier jour où le quiz quotidien ait jamais pu
// exister. Personne n'a donc pu légitimement y jouer, et aucun jour réel (passé ou à venir) ne
// pourra jamais coïncider avec elle — le score du quiz surprise s'ajoute ainsi à quiz_results
// (classement de saison habituel, basé sur completed_at, pas quiz_date) sans jamais apparaître
// dans l'onglet "Aujourd'hui" de qui que ce soit, aujourd'hui ou un autre jour.
const SPECIAL_QUIZ_LEDGER_DATE = "2025-01-01";

/** Revalide indépendamment côté serveur, même principe que submitQuizAnswer (voir
 * src/app/quiz/actions.ts) : le client n'envoie que son choix, jamais la question ni la bonne
 * réponse. */
export async function submitSpecialQuizAnswer(
  token: string,
  position: number,
  choiceIndex: number | null
): Promise<SubmitSpecialQuizAnswerResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  const admin = createServiceRoleClient();
  const { data: specialQuiz } = await admin
    .from("special_quizzes")
    .select("id, user_id, questions")
    .eq("token", token)
    .maybeSingle();
  // Même réponse générique qu'un jeton inconnu : ne jamais révéler à un utilisateur connecté que
  // "ce jeton existe mais n'est pas le tien" (voir page.tsx, même logique pour l'affichage).
  if (!specialQuiz || specialQuiz.user_id !== user.id) return { error: "Quiz introuvable." };

  const questions = specialQuiz.questions;
  const question = questions[position];
  if (!question) return { error: "Question introuvable." };

  const { data: priorAnswers } = await admin
    .from("special_quiz_answers")
    .select("is_correct, points")
    .eq("special_quiz_id", specialQuiz.id)
    .order("position", { ascending: true });
  const answered = priorAnswers ?? [];
  if (answered.length !== position) return { error: "Question déjà répondue ou hors séquence." };

  let streak = 0;
  for (const a of answered) {
    if (a.is_correct) streak++;
    else streak = 0;
  }

  const isCorrect = choiceIndex !== null && choiceIndex === question.correct_index;
  const streakAfter = isCorrect ? streak + 1 : 0;
  // Même barème que le quiz quotidien (src/app/quiz/actions.ts, submitQuizAnswer) : 1 pt par
  // bonne réponse, 2 pts à partir d'une série de 3, +3 pts si le quiz est réussi à 100 % — jamais
  // un barème inventé pour l'occasion.
  const points = isCorrect ? (streakAfter >= 3 ? 2 : 1) : 0;

  const { error } = await admin.from("special_quiz_answers").insert({
    special_quiz_id: specialQuiz.id,
    position,
    choice_index: choiceIndex,
    is_correct: isCorrect,
    points,
  });
  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("special_quiz_answers")
        .select("is_correct, points")
        .eq("special_quiz_id", specialQuiz.id)
        .eq("position", position)
        .maybeSingle();
      if (existing) {
        return {
          error: null,
          isCorrect: existing.is_correct,
          correctIndex: question.correct_index,
          explanation: question.explanation,
          points: existing.points,
          streakAfter: existing.is_correct ? streak + 1 : 0,
          finalScore: null,
        };
      }
    }
    return { error: error.message };
  }

  let finalScore: number | null = null;
  if (position === questions.length - 1) {
    const totalPoints = answered.reduce((sum, a) => sum + a.points, 0) + points;
    const correctCount = answered.filter((a) => a.is_correct).length + (isCorrect ? 1 : 0);
    const bonus = correctCount === questions.length ? 3 : 0;
    finalScore = totalPoints + bonus;

    // Écrit dans la VRAIE table quiz_results (celle du classement de saison habituel,
    // src/app/quiz/actions.ts/getQuizSeasonLeaderboard) — demande explicite de l'utilisateur
    // ("ajoute son score au classement habituel"). quiz_date = sentinelle ci-dessus, jamais une
    // date réelle : n'apparaît donc jamais dans le classement du jour de qui que ce soit, mais
    // completed_at (maintenant, par défaut) le compte bien dans le total de saison.
    await admin.from("quiz_results").upsert(
      {
        user_id: user.id,
        quiz_date: SPECIAL_QUIZ_LEDGER_DATE,
        score: finalScore,
        correct_count: correctCount,
      },
      { onConflict: "user_id,quiz_date" }
    );
  }

  return {
    error: null,
    isCorrect,
    correctIndex: question.correct_index,
    explanation: question.explanation,
    points,
    streakAfter,
    finalScore,
  };
}
