-- Mini-jeu "prime à l'outsider" : chaque lundi, si la personne qui a le mieux pronostiqué sur les
-- 7 derniers jours (tous championnats actifs confondus) n'est PAS dans le top 3 du classement
-- général, elle reçoit un bonus fixe de 50 points — pensé pour garder tout le monde dans la course
-- au titre plus longtemps, même décroché en milieu de saison (voir api/cron/weekly-outsider-bonus).
--
-- Une ligne par semaine (contrainte unique sur week_start), même si aucune prime n'est distribuée
-- cette semaine-là (user_id reste alors null) — sert à la fois d'idempotence (ne jamais retraiter
-- une semaine déjà vue) et d'historique.
create table public.weekly_outsider_bonuses (
  id bigserial primary key,
  week_start date not null unique,
  user_id uuid references auth.users (id),
  points integer not null default 50,
  granted_at timestamptz not null default now()
);

alter table public.weekly_outsider_bonuses enable row level security;
-- Même modèle que midseason_bonuses : lecture publique (afficher qui a gagné la prime récemment),
-- aucune écriture cliente — seul le service role (le cron) y écrit.
create policy "weekly outsider bonuses are readable by any authenticated user"
  on public.weekly_outsider_bonuses for select
  to authenticated
  using (true);

alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop',
  'season_final_team', 'season_final_winner',
  'midseason_malus',
  'quiz_season_bonus',
  'midseason_bonus_gift',
  'weekly_outsider_bonus'
));
