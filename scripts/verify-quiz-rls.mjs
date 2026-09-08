// Vérifie que la migration 0041_fix_quiz_rls.sql empêche bien un utilisateur authentifié
// d'écrire directement sur quiz_answers/quiz_results via l'API Supabase (client anon + session),
// en contournant submitQuizAnswer. À exécuter AVANT la migration (doit réussir à écrire — preuve
// de la faille) puis APRÈS (doit être rejeté avec le code 42501).
//
// Usage : SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... node scripts/verify-quiz-rls.mjs
// (utilise NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY du .env.local existant, et un
// compte de test dédié — ne jamais pointer ce script vers le compte d'un vrai joueur.)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SUPABASE_TEST_EMAIL;
const password = process.env.SUPABASE_TEST_PASSWORD;

if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquants.");
if (!email || !password) throw new Error("SUPABASE_TEST_EMAIL / SUPABASE_TEST_PASSWORD manquants (compte de test dédié).");

const supabase = createClient(url, anonKey);

const {
  data: { user },
  error: authError,
} = await supabase.auth.signInWithPassword({ email, password });
if (authError || !user) throw new Error(`Connexion échouée : ${authError?.message}`);

console.log(`Connecté en tant que ${user.id}. Tentative d'écriture directe (doit échouer après la migration 0041)…`);

const today = new Date().toISOString().slice(0, 10);

const resultAttempt = await supabase
  .from("quiz_results")
  .update({ score: 9999, correct_count: 10 })
  .eq("user_id", user.id)
  .eq("quiz_date", today)
  .select();

const answerAttempt = await supabase.from("quiz_answers").insert({
  user_id: user.id,
  quiz_date: today,
  position: 0,
  choice_index: 0,
  is_correct: true,
  points: 999,
});

function report(label, { data, error }) {
  if (error) {
    console.log(`[BLOQUÉ, attendu après migration] ${label} : ${error.code} — ${error.message}`);
  } else {
    console.log(
      `[ÉCRITURE PASSÉE — faille présente si la migration 0041 est déjà appliquée] ${label} :`,
      data
    );
  }
}

report("quiz_results.update", resultAttempt);
report("quiz_answers.insert", answerAttempt);

await supabase.auth.signOut();
