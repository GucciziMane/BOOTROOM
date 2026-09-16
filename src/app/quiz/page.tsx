import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDailyQuiz, quizDayString, stripAnswer } from "@/lib/quiz/daily";
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
  const quizDate = quizDayString();

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

  const quiz = await getDailyQuiz(admin, quizDate, user.id);
  const publicQuiz = quiz.map(stripAnswer);

  // Filet de secours : si les 10 réponses existent déjà mais qu'aucun quiz_results n'a été
  // enregistré (l'upsert dans submitQuizAnswer a pu échouer une fois sans que personne ne le
  // revoie — jamais vérifié côté appelant), le joueur qui a bien terminé son quiz retombait pour
  // toujours sur "pas encore disponible" au lieu de son résultat, avec plus aucun moyen de
  // resoumettre (la position est hors limites, et chaque position n'accepte qu'une réponse). On
  // recalcule ici depuis les réponses déjà en base — jamais inventé, la même formule que
  // submitQuizAnswer — et on retente l'enregistrement pour que les prochains chargements n'aient
  // plus besoin de repasser par ce recalcul.
  let existingResultRow = existingResult;
  if (!existingResultRow && (existingAnswers?.length ?? 0) === quiz.length && quiz.length > 0) {
    const totalPoints = existingAnswers!.reduce((sum, a) => sum + a.points, 0);
    const correctCount = existingAnswers!.filter((a) => a.is_correct).length;
    const bonus = correctCount === quiz.length ? 3 : 0;
    const recoveredScore = totalPoints + bonus;
    await admin
      .from("quiz_results")
      .upsert({ user_id: user.id, quiz_date: quizDate, score: recoveredScore, correct_count: correctCount }, { onConflict: "user_id,quiz_date" });
    existingResultRow = { score: recoveredScore };
  }

  return (
    // Hauteur ancrée sur le viewport réel (moins la barre du bas et la safe-area, cf. page.tsx du
    // dashboard) + overflow-hidden : sans ça, la page défilait de haut en bas dès que son contenu
    // dépassait un écran, ce que l'utilisateur ne veut pas ici — l'écran doit rester fixe.
    <main className="mx-auto flex h-[calc(100dvh-env(safe-area-inset-top)-8rem)] w-full max-w-2xl flex-1 flex-col overflow-hidden px-6 pb-3 pt-4 lg:h-[calc(100dvh-env(safe-area-inset-top))]">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-bold">Quiz du jour 🧠</h1>
        <BackLink href="/" />
      </div>

      <div className="min-h-0 flex-1">
        <QuizRunner
          questions={publicQuiz}
          initialAnswers={(existingAnswers ?? []).map((a) => ({
            position: a.position,
            isCorrect: a.is_correct,
            points: a.points,
          }))}
          initialFinalScore={existingResultRow?.score ?? null}
          showPrivateRanking={showPrivateRanking}
          quizDate={quizDate}
        />
      </div>
    </main>
  );
}
