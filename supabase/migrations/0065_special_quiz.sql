-- Quiz surprise à usage unique, pour un seul joueur précis (demande explicite de l'utilisateur :
-- féliciter kaism10 de sa fidélité/ses performances via un quiz de 20 questions rien que pour lui,
-- sans piocher dans la banque quiz_questions, qui compte au classement habituel). Entièrement
-- séparé de la banque et des tables quiz_answers/quiz_results : quiz_answers.position a une
-- contrainte CHECK <= 9 (le quiz quotidien partagé compte toujours 10 questions, jamais 20), donc
-- un quiz de 20 questions ne peut structurellement pas y tenir sans toucher à une invariante
-- partagée par tout le monde — un schéma à part évite tout risque pour le quiz quotidien normal.
--
-- Les questions sont stockées en jsonb directement sur la ligne (pas de table séparée par
-- question) : un seul destinataire, un seul quiz, pas besoin de la normalisation qu'impose
-- quiz_questions (banque partagée, des centaines de lignes réutilisées tous les jours).

create table public.special_quizzes (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Jeton imprévisible inclus dans le lien envoyé en notification : seule façon d'atteindre la
  -- page (src/app/quiz/special/[token]/page.tsx vérifie en plus que auth.uid() = user_id, défense
  -- en profondeur si jamais le lien fuitait).
  token text not null unique,
  title text not null,
  intro_message text not null,
  outro_message text not null,
  questions jsonb not null,
  created_at timestamptz not null default now()
);

create table public.special_quiz_answers (
  id bigserial primary key,
  special_quiz_id bigint not null references public.special_quizzes (id) on delete cascade,
  position smallint not null check (position >= 0),
  choice_index smallint check (choice_index is null or choice_index between 0 and 3),
  is_correct boolean not null,
  points integer not null,
  created_at timestamptz not null default now(),
  unique (special_quiz_id, position)
);

alter table public.special_quizzes enable row level security;
alter table public.special_quiz_answers enable row level security;

-- Comme quiz_questions (voir 0016_quiz.sql) : volontairement aucune policy select pour
-- "authenticated" sur special_quizzes — les questions (avec correct_index/explanation en clair)
-- n'y sont lisibles que par le serveur (service role). Le client ne reçoit, via la Server
-- Component de la page, que les questions/choix dépouillés de leur réponse.

create policy "users manage their own special quiz answers"
  on public.special_quiz_answers for all
  to authenticated
  using (exists (
    select 1 from public.special_quizzes sq
    where sq.id = special_quiz_answers.special_quiz_id and sq.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.special_quizzes sq
    where sq.id = special_quiz_answers.special_quiz_id and sq.user_id = auth.uid()
  ));
