import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { PRIVATE_RANKING_USERNAMES } from "@/lib/leaderboard-reset";
import { BackLink } from "@/app/BackLink";
import { SpecialQuizRunner, type SpecialQuestionPublic } from "./SpecialQuizRunner";

// Quiz surprise à usage unique, réservé à un seul utilisateur (voir actions.ts et
// supabase/migrations/0065_special_quiz.sql) — le jeton dans l'URL est la seule façon d'y
// accéder, mais `notFound()` générique dès que l'utilisateur connecté n'est pas le destinataire :
// jamais de message du type "ce n'est pas ton quiz", qui confirmerait à quelqu'un d'autre que la
// page existe. Un jeton inconnu et un jeton valide appartenant à quelqu'un d'autre rendent donc
// exactement la même 404.
const SPECIAL_QUIZ_LEDGER_DATE = "2025-01-01";

export default async function SpecialQuizPage({ params }: PageProps<"/quiz/special/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();
  const { data: specialQuiz } = await admin
    .from("special_quizzes")
    .select("id, user_id, title, intro_message, outro_message, questions")
    .eq("token", token)
    .maybeSingle();
  if (!specialQuiz || specialQuiz.user_id !== user.id) notFound();

  const [{ data: existingAnswers }, { data: profile }] = await Promise.all([
    admin
      .from("special_quiz_answers")
      .select("position, is_correct, points")
      .eq("special_quiz_id", specialQuiz.id)
      .order("position", { ascending: true }),
    admin.from("profiles").select("username").eq("id", user.id).single(),
  ]);
  const showPrivateRanking = PRIVATE_RANKING_USERNAMES.includes(profile?.username ?? "");

  const answers = existingAnswers ?? [];
  let initialFinalScore: number | null = null;
  if (answers.length === specialQuiz.questions.length && specialQuiz.questions.length > 0) {
    const { data: result } = await admin
      .from("quiz_results")
      .select("score")
      .eq("user_id", user.id)
      .eq("quiz_date", SPECIAL_QUIZ_LEDGER_DATE)
      .maybeSingle();
    initialFinalScore = result?.score ?? null;
  }

  // Jamais correct_index/explanation envoyés au client avant d'avoir répondu (même principe que
  // src/lib/quiz/daily.ts, stripAnswer).
  const publicQuestions: SpecialQuestionPublic[] = specialQuiz.questions.map((q) => ({
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    choices: q.choices,
  }));

  return (
    <main className="mx-auto flex h-[calc(100dvh-env(safe-area-inset-top)-8rem)] w-full max-w-2xl flex-1 flex-col overflow-hidden px-6 pb-3 pt-4 lg:h-[calc(100dvh-env(safe-area-inset-top))]">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-bold">🎁 {specialQuiz.title}</h1>
        <BackLink href="/" />
      </div>

      <div className="min-h-0 flex-1">
        <SpecialQuizRunner
          token={token}
          title={specialQuiz.title}
          introMessage={specialQuiz.intro_message}
          outroMessage={specialQuiz.outro_message}
          questions={publicQuestions}
          initialAnswers={answers.map((a) => ({ position: a.position, isCorrect: a.is_correct, points: a.points }))}
          initialFinalScore={initialFinalScore}
          showPrivateRanking={showPrivateRanking}
        />
      </div>
    </main>
  );
}
