-- Faille : la policy "for all" posée par 0065_special_quiz.sql ne vérifiait que la propriété de
-- la ligne (special_quiz_id -> special_quizzes.user_id = auth.uid()), jamais son contenu. Un
-- utilisateur authentifié pouvait donc appeler l'API Supabase directement depuis le navigateur
-- pour forger is_correct/points sur ses propres special_quiz_answers, en contournant entièrement
-- submitSpecialQuizAnswer (src/app/quiz/special/[token]/actions.ts) — même patron que la faille
-- admin déjà corrigée en 0023 et la faille quiz_answers/quiz_results déjà corrigée en 0041, cette
-- fois sur la table (plus récente) du quiz surprise à usage unique.
--
-- Vérifié avant cette migration : tous les accès à special_quiz_answers dans le dépôt
-- (src/app/quiz/special/[token]/actions.ts, src/app/quiz/special/[token]/page.tsx) passent par
-- createServiceRoleClient(), jamais par le client utilisateur — aucun code applicatif ne dépend
-- de la policy d'écriture retirée ici.

drop policy "users manage their own special quiz answers" on public.special_quiz_answers;

-- Remplace l'ancienne policy "for all" par une policy de lecture seule, qui préserve exactement
-- le même périmètre (ses propres réponses) sans autoriser l'écriture directe.
create policy "users read their own special quiz answers"
  on public.special_quiz_answers for select
  to authenticated
  using (exists (
    select 1 from public.special_quizzes sq
    where sq.id = special_quiz_answers.special_quiz_id and sq.user_id = auth.uid()
  ));

-- Pas de policy insert/update/delete : écriture réservée au rôle service, comme quiz_answers
-- (0041) et points_ledger (0001_init.sql).
