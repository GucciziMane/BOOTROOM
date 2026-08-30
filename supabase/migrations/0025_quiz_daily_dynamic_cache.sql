-- Les questions dynamiques (hidden_teammate, guess_crest, guess_player_team, guess_match_score)
-- étaient recalculées à la volée depuis teams/players/matches à CHAQUE appel de getDailyQuiz —
-- aussi bien pour afficher la question que pour valider la réponse. Le tirage est déterministe
-- (seed = date + position), mais dépend du contenu ET de la longueur des tableaux teams/players/
-- matches, pas seulement de leur ordre (déjà figé via .order("id")). Si un cron de sync
-- (sync-teams-players, sync-fixtures, toutes les 2h) modifie cet ensemble entre l'affichage d'une
-- question et sa validation, le tirage peut changer et invalider la réponse d'un utilisateur en
-- plein quiz.
--
-- Cette table fige les questions dynamiques du jour dès leur première génération : tous les
-- appels suivants (affichage et validation) lisent la même version, quoi que fassent les crons
-- ensuite. Même politique RLS que quiz_questions : correct_index en clair, jamais exposé au
-- client, seul le service role y accède.

create table public.quiz_daily_dynamic (
  quiz_date date not null,
  position smallint not null check (position between 0 and 9),
  category text not null,
  difficulty text not null,
  question text not null,
  team_logo_url text,
  choices jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text,
  created_at timestamptz not null default now(),
  primary key (quiz_date, position)
);

alter table public.quiz_daily_dynamic enable row level security;
-- Volontairement aucune policy : correct_index en clair, lu uniquement via le service role côté serveur.
