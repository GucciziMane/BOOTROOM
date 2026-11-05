-- Classement de la semaine (lundi 00h -> lundi 00h, Europe/Paris) : chaque lundi, le n°1 de la
-- semaine écoulée (points de pronos uniquement, tous championnats actifs confondus) reçoit +100
-- points au classement général — voir api/cron/weekly-winner-bonus. Remplace la prime à
-- l'outsider (migration 0056) : la table weekly_outsider_bonuses et ses lignes ledger restent en
-- place comme historique, plus rien n'y écrit.
--
-- Une ligne par gagnant (ex aequo : chacun la sienne, chacun +100), ou une seule ligne user_id null
-- si personne n'a marqué de points de prono cette semaine-là — sert à la fois d'idempotence (une
-- semaine déjà vue n'est jamais retraitée) et d'historique.
create table public.weekly_winner_bonuses (
  id bigserial primary key,
  week_start date not null,
  iso_year integer not null,
  iso_week integer not null,
  user_id uuid references auth.users (id),
  week_points integer not null default 0,
  points integer not null default 100,
  granted_at timestamptz not null default now(),
  unique nulls not distinct (week_start, user_id)
);

alter table public.weekly_winner_bonuses enable row level security;
-- Même modèle que weekly_outsider_bonuses : lecture par tout utilisateur connecté (badge du
-- gagnant), aucune écriture cliente — seul le service role (le cron) y écrit.
create policy "weekly winner bonuses are readable by any authenticated user"
  on public.weekly_winner_bonuses for select
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
  'weekly_outsider_bonus',
  'ballon_dor',
  'weekly_winner_bonus'
));
