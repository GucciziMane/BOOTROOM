// Rattrapage des réponses du 2026-10-08 pénalisées par la question 454 cassée (voir
// supabase/migrations/0064_quiz_question_fixes.sql) : son énoncé décrivait "un milieu espagnol,
// capitaine du Barça" alors que la réponse enregistrée est le gardien Iker Casillas. Les joueurs
// qui ont répondu "Xavi Hernández" — la seule réponse défendable au vu de l'énoncé qui leur a été
// affiché — ont été comptés faux.
//
// Ne crédite QUE les réponses "Xavi Hernández" de la position concernée, ce jour-là : une réponse
// Iniesta/Ramos restait fausse dans tous les cas, et une réponse Casillas était déjà comptée juste.
// L'ordre des choix étant mélangé par joueur (lib/quiz/daily.ts), le choix est résolu en libellé
// via ce même mélange plutôt qu'en comparant des index bruts.
//
// Barème rejoué à l'identique (actions.ts) : 1 point, ou 2 si la série atteint 3 — recalculé ici
// depuis les réponses réelles, jamais une valeur supposée. Les réponses suivantes sont recalculées
// elles aussi au cas où la série repartirait différemment, puis quiz_results est remis à jour pour
// les quiz déjà terminés (completed_at laissé intact).
//
// Idempotent : relancé, il ne trouve plus de réponse à corriger.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/fix-quiz-454-answers.mjs
import { createClient } from "@supabase/supabase-js";
import { getDailyQuiz } from "../src/lib/quiz/daily";

const QUIZ_DATE = "2026-10-08";
const BROKEN_POSITION = 2;
const ANSWER_TO_CREDIT = "Xavi Hernández";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: answers } = await supabase
    .from("quiz_answers")
    .select("user_id, position, choice_index, is_correct, points")
    .eq("quiz_date", QUIZ_DATE)
    .order("user_id")
    .order("position", { ascending: true });

  const byUser = new Map();
  for (const a of answers ?? []) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
    byUser.get(a.user_id).push(a);
  }

  let credited = 0;
  for (const [userId, list] of byUser) {
    const quiz = await getDailyQuiz(supabase, QUIZ_DATE, userId);
    const broken = list.find((a) => a.position === BROKEN_POSITION);
    if (!broken || broken.is_correct || broken.choice_index == null) continue;
    if (quiz[BROKEN_POSITION]?.choices[broken.choice_index] !== ANSWER_TO_CREDIT) continue;

    // Rejoue tout le barème du jour pour cet utilisateur, la position corrigée devenant juste :
    // la série (et donc le passage à 2 points) peut changer pour les questions SUIVANTES.
    let streak = 0;
    let changedRows = 0;
    for (const a of list) {
      const isCorrect = a.position === BROKEN_POSITION ? true : a.is_correct;
      streak = isCorrect ? streak + 1 : 0;
      const points = isCorrect ? (streak >= 3 ? 2 : 1) : 0;
      if (isCorrect !== a.is_correct || points !== a.points) {
        const { error } = await supabase
          .from("quiz_answers")
          .update({ is_correct: isCorrect, points })
          .eq("user_id", userId)
          .eq("quiz_date", QUIZ_DATE)
          .eq("position", a.position);
        if (error) throw new Error(`maj réponse p${a.position}: ${error.message}`);
        a.is_correct = isCorrect;
        a.points = points;
        changedRows++;
      }
    }
    credited++;
    console.log(`  ${userId}: position ${BROKEN_POSITION} créditée, ${changedRows} ligne(s) recalculée(s).`);

    // quiz_results n'existe que pour un quiz terminé : sinon il sera calculé normalement à la
    // dernière réponse, à partir des lignes qu'on vient de corriger.
    if (list.length === quiz.length && quiz.length > 0) {
      const totalPoints = list.reduce((sum, a) => sum + a.points, 0);
      const correctCount = list.filter((a) => a.is_correct).length;
      const score = totalPoints + (correctCount === quiz.length ? 3 : 0);
      const { error } = await supabase
        .from("quiz_results")
        .update({ score, correct_count: correctCount })
        .eq("user_id", userId)
        .eq("quiz_date", QUIZ_DATE);
      if (error) throw new Error(`maj résultat: ${error.message}`);
      console.log(`    quiz terminé -> score=${score}, correct_count=${correctCount}`);
    } else {
      console.log(`    quiz non terminé (${list.length}/${quiz.length}) : score calculé à la dernière réponse.`);
    }
  }

  console.log(`Terminé : ${credited} joueur(s) rattrapé(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
