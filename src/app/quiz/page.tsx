import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDailyQuiz, parisDateString, stripAnswer } from "@/lib/quiz/daily";
import { linkMuted } from "@/lib/ui";
import { QuizRunner } from "./QuizRunner";

export default async function QuizPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();
  const quizDate = parisDateString();

  const [{ data: existingAnswers }, { data: existingResult }] = await Promise.all([
    admin
      .from("quiz_answers")
      .select("position, is_correct")
      .eq("user_id", user.id)
      .eq("quiz_date", quizDate)
      .order("position", { ascending: true }),
    admin.from("quiz_results").select("score").eq("user_id", user.id).eq("quiz_date", quizDate).maybeSingle(),
  ]);

  const quiz = await getDailyQuiz(admin, quizDate);
  const publicQuiz = quiz.map(stripAnswer);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Quiz du jour 🧠</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <QuizRunner
        questions={publicQuiz}
        initialAnsweredCount={existingAnswers?.length ?? 0}
        initialStreak={(() => {
          let s = 0;
          for (const a of existingAnswers ?? []) {
            if (a.is_correct) s++;
            else s = 0;
          }
          return s;
        })()}
        initialFinalScore={existingResult?.score ?? null}
      />
    </main>
  );
}
