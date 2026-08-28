-- Quiz quotidien (10 questions, mêmes pour tout le monde chaque jour, calculées à la volée à
-- partir de la date Europe/Paris — pas de cron nécessaire pour "générer" le quiz du jour).

create table public.quiz_questions (
  id bigserial primary key,
  category text not null check (category in ('score', 'player_career', 'trivia', 'vintage_jersey')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  question text not null,
  choices jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text,
  active boolean not null default true
);

-- Une réponse par utilisateur/jour/position (0-9). La bonne réponse n'est jamais recalculée
-- côté client : le serveur revalide indépendamment à partir de (quiz_date, position).
create table public.quiz_answers (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  quiz_date date not null,
  position smallint not null check (position between 0 and 9),
  choice_index smallint not null check (choice_index between 0 and 3),
  is_correct boolean not null,
  points integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, quiz_date, position)
);

create table public.quiz_results (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  quiz_date date not null,
  score integer not null,
  correct_count smallint not null,
  completed_at timestamptz not null default now(),
  unique (user_id, quiz_date)
);
create index quiz_results_quiz_date_idx on public.quiz_results (quiz_date);

alter table public.quiz_questions enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.quiz_results enable row level security;

-- Volontairement aucune policy select sur quiz_questions pour "authenticated" : la bonne
-- réponse y est en clair. Seul le serveur (service role, cf. src/lib/supabase/server.ts) la lit ;
-- le client ne reçoit que les questions/choix, jamais correct_index, via les Server Components.

create policy "users manage their own quiz answers"
  on public.quiz_answers for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "quiz results readable by any authenticated user"
  on public.quiz_results for select
  to authenticated
  using (true);

create policy "users insert their own quiz result"
  on public.quiz_results for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users update their own quiz result"
  on public.quiz_results for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Banque de questions (23 pour démarrer : ~4 jours sans répétition en easy/medium, ~2 en hard —
-- facile à agrandir plus tard en ajoutant des lignes, sans toucher au code).

insert into public.quiz_questions (category, difficulty, question, choices, correct_index, explanation) values
('trivia', 'easy', 'Combien de joueurs une équipe aligne-t-elle sur le terrain, gardien inclus ?', '["10", "11", "12", "7"]', 1, 'Une équipe complète compte 11 joueurs, dont le gardien.'),
('trivia', 'easy', 'Quelle couleur de carton entraîne l''exclusion immédiate d''un joueur ?', '["Jaune", "Bleu", "Rouge", "Vert"]', 2, 'Le carton rouge signifie une expulsion directe.'),
('score', 'easy', 'Quel pays a remporté la Coupe du Monde 2018 en Russie ?', '["Croatie", "France", "Belgique", "Angleterre"]', 1, 'La France a battu la Croatie 4-2 en finale.'),
('trivia', 'easy', 'Quelle est la durée réglementaire d''un match de football, hors prolongations ?', '["80 minutes", "90 minutes", "100 minutes", "120 minutes"]', 1, 'Deux mi-temps de 45 minutes, soit 90 minutes.'),
('player_career', 'easy', 'Cet attaquant portugais surnommé "CR7" est passé par Manchester United, le Real Madrid puis la Juventus. Qui est-il ?', '["Nani", "Cristiano Ronaldo", "Luís Figo", "Pepe"]', 1, null),
('trivia', 'easy', 'Combien de temps dure la pause à la mi-temps d''un match officiel ?', '["5 minutes", "10 minutes", "15 minutes", "20 minutes"]', 2, null),
('score', 'easy', 'Quelle équipe a remporté la Coupe du Monde 2014, disputée au Brésil ?', '["Argentine", "Brésil", "Allemagne", "Pays-Bas"]', 2, 'L''Allemagne a battu l''Argentine 1-0 en finale.'),
('trivia', 'easy', 'Comment appelle-t-on le fait, pour un joueur, de marquer trois buts dans un même match ?', '["Un doublé", "Un triplé", "Un carton plein", "Un grand chelem"]', 1, 'On parle aussi de "hat-trick".'),
('player_career', 'medium', 'Cet attaquant suédois est passé, dans cet ordre, par l''Ajax, l''Inter Milan, le FC Barcelone, l''AC Milan puis le Paris Saint-Germain. Qui est-il ?', '["Zlatan Ibrahimović", "Henrik Larsson", "Freddie Ljungberg", "Kim Källström"]', 0, null),
('score', 'medium', 'En finale de la Ligue des Champions 2005 à Istanbul, l''AC Milan menait 3-0 à la mi-temps face à Liverpool. Quel a été le score final, après prolongations ?', '["3-1", "3-2", "3-3", "4-2"]', 2, 'Liverpool a égalisé 3-3 avant de s''imposer aux tirs au but.'),
('trivia', 'medium', 'Quel club anglais, surnommé "les Reds", joue à domicile à Anfield ?', '["Manchester United", "Arsenal", "Liverpool", "Nottingham Forest"]', 2, null),
('vintage_jersey', 'medium', 'Dans les années 1990, ce club londonien portait un maillot domicile rayé rouge et blanc, sponsorisé par "JVC". De quel club s''agit-il ?', '["Chelsea", "Tottenham", "Arsenal", "West Ham"]', 2, null),
('player_career', 'medium', 'Ce milieu de terrain français est passé, dans cet ordre, par Cannes, Bordeaux, la Juventus puis le Real Madrid. Qui est-il ?', '["Didier Deschamps", "Youri Djorkaeff", "Zinédine Zidane", "Robert Pirès"]', 2, null),
('trivia', 'medium', 'Combien d''équipes participaient à la phase finale de la Coupe du Monde entre 1998 et 2022, avant l''extension à 48 équipes en 2026 ?', '["24", "32", "40", "48"]', 1, null),
('vintage_jersey', 'medium', 'Ce club milanais, surnommé les "nerazzurri", porte historiquement un maillot rayé bleu et noir. De quel club s''agit-il ?', '["AC Milan", "Inter Milan", "Juventus", "AS Roma"]', 1, null),
('score', 'medium', 'En finale de la Coupe du Monde 1966, Geoff Hurst a réalisé l''unique triplé de l''histoire des finales. Combien de buts a-t-il marqués ?', '["2", "3", "4", "1"]', 1, 'L''Angleterre avait battu l''Allemagne de l''Ouest 4-2.'),
('score', 'hard', 'Quel a été le score de la finale de la Coupe du Monde 1998, entre la France et le Brésil ?', '["3-0", "2-1", "3-1", "4-2"]', 0, 'Doublé de Zidane et but de Petit.'),
('player_career', 'hard', 'Ce gardien italien a joué toute sa carrière de club entre le Parme et la Juventus, disputant plus de 1000 matchs professionnels. Qui est-il ?', '["Francesco Toldo", "Angelo Peruzzi", "Gianluigi Buffon", "Marco Ballotta"]', 2, null),
('score', 'hard', 'En 1999, Manchester United a remporté la Ligue des Champions grâce à deux buts marqués dans les arrêts de jeu face au Bayern Munich. Quel était le score final ?', '["2-1", "3-1", "2-0", "1-0"]', 0, 'Buts de Sheringham puis Solskjær, en fin de match.'),
('vintage_jersey', 'hard', 'Dans les années 1970, ce club néerlandais portait un maillot blanc avec une large bande verticale rouge au centre, porté notamment par Johan Cruyff. De quel club s''agit-il ?', '["Feyenoord", "PSV Eindhoven", "Ajax Amsterdam", "AZ Alkmaar"]', 2, null),
('score', 'hard', 'Quel a été le score, après prolongations, de la finale de la Coupe du Monde 2006 entre l''Italie et la France ?', '["1-1", "2-2", "1-0", "0-0"]', 0, 'L''Italie s''est finalement imposée 5-3 aux tirs au but.'),
('player_career', 'hard', 'Ce défenseur italien, capitaine de l''Italie championne du monde en 2006 et Ballon d''or la même année, est passé par Parme, l''Inter Milan et la Juventus. Qui est-il ?', '["Alessandro Nesta", "Fabio Cannavaro", "Paolo Maldini", "Marco Materazzi"]', 1, null),
('score', 'hard', 'Quel a été le score de la demi-finale de la Coupe du Monde 2014 entre le Brésil et l''Allemagne, restée célèbre sous le nom de "Mineirazo" ?', '["7-1", "5-0", "6-2", "4-1"]', 0, 'L''Allemagne, future championne du monde, avait écrasé le Brésil à domicile.');
