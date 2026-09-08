-- Faille : les policies posées par 0016_quiz.sql couvraient aussi l'écriture (for all / for
-- update) en ne vérifiant que la propriété de la ligne (auth.uid() = user_id), jamais son
-- contenu. Un utilisateur authentifié pouvait donc appeler l'API Supabase directement depuis le
-- navigateur pour forger is_correct/points sur quiz_answers ou score/correct_count sur
-- quiz_results, en contournant entièrement submitQuizAnswer (src/app/quiz/actions.ts) — même
-- patron que la faille d'auto-promotion admin déjà corrigée en 0023.
--
-- Vérifié avant cette migration : tous les accès à ces deux tables dans le dépôt (src/app/quiz/
-- actions.ts, src/app/quiz/page.tsx) passent par createServiceRoleClient(), jamais par le client
-- utilisateur — aucun code applicatif ne dépend des policies d'écriture retirées ici.

drop policy "users manage their own quiz answers" on public.quiz_answers;

-- Remplace l'ancienne policy "for all" par une policy de lecture seule, qui préserve exactement
-- le même périmètre (ses propres réponses) sans autoriser l'écriture directe.
create policy "users read their own quiz answers"
  on public.quiz_answers for select
  to authenticated
  using (auth.uid() = user_id);

-- Pas de policy insert/update/delete sur quiz_answers : écriture réservée au rôle service, comme
-- points_ledger (0001_init.sql).

drop policy "users insert their own quiz result" on public.quiz_results;
drop policy "users update their own quiz result" on public.quiz_results;

-- La policy "quiz results readable by any authenticated user" (select, using (true)) est
-- conservée telle quelle : elle alimente le classement du quiz, une lecture publique volontaire,
-- et n'est pas la faille.
