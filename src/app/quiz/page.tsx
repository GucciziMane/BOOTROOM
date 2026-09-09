import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDailyQuiz, parisDateString, stripAnswer } from "@/lib/quiz/daily";
import { BackLink } from "@/app/BackLink";
import { PRIVATE_RANKING_USERNAMES } from "@/lib/leaderboard-reset";
import { QuizRunner } from "./QuizRunner";

export default async function QuizPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();
  const quizDate = parisDateString();

  const [{ data: existingAnswers }, { data: existingResult }, { data: profile }] = await Promise.all([
    admin
      .from("quiz_answers")
      .select("position, is_correct, points")
      .eq("user_id", user.id)
      .eq("quiz_date", quizDate)
      .order("position", { ascending: true }),
    admin.from("quiz_results").select("score").eq("user_id", user.id).eq("quiz_date", quizDate).maybeSingle(),
    admin.from("profiles").select("username").eq("id", user.id).single(),
  ]);
  const showPrivateRanking = PRIVATE_RANKING_USERNAMES.includes(profile?.username ?? "");

  const quiz = await getDailyQuiz(admin, quizDate);
  const publicQuiz = quiz.map(stripAnswer);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Quiz du jour 🧠</h1>
        <BackLink href="/" />
      </div>

      <QuizRunner
        questions={publicQuiz}
        initialAnswers={(existingAnswers ?? []).map((a) => ({
          position: a.position,
          isCorrect: a.is_correct,
          points: a.points,
        }))}
        initialFinalScore={existingResult?.score ?? null}
        showPrivateRanking={showPrivateRanking}
      />
    </main>
  );
}
