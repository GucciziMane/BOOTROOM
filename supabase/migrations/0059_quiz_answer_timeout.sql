-- Minuteur de 10s par question (voir QuizRunner.tsx) : si le temps s'écoule sans réponse, le
-- client soumet quand même la question comme "pas de réponse" plutôt que de la laisser bloquée
-- indéfiniment — choice_index doit donc pouvoir être NULL, jusque-là toujours NOT NULL avec un
-- CHECK entre 0 et 3.
alter table public.quiz_answers alter column choice_index drop not null;
alter table public.quiz_answers drop constraint quiz_answers_choice_index_check;
alter table public.quiz_answers add constraint quiz_answers_choice_index_check
  check (choice_index is null or choice_index between 0 and 3);
