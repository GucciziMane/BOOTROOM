-- Saison du quiz indépendante de la remise à zéro du classement général des pronos (jusqu'ici les
-- deux partageaient LEADERBOARD_RESET_KEY, cf. src/lib/leaderboard-reset.ts) : le quiz doit pouvoir
-- repartir sur une saison vierge chaque 1er janvier sans toucher au classement des pronos, qui
-- continue d'accumuler. Nouvelle clé dédiée, seedée avec la valeur actuelle de la remise à zéro
-- existante pour que le classement "Saison 🏆" du quiz affiché aujourd'hui ne bouge pas au
-- déploiement — seul un futur passage du cron quiz-season-bonus (1er janvier) la fera diverger.
insert into public.app_settings (key, value)
  select 'quiz_season_reset_at', value from public.app_settings where key = 'leaderboard_reset_at'
  on conflict (key) do nothing;

-- Bonus de fin de saison quiz (1er/2e du classement "Saison" au 31 décembre) : +100/+50 points
-- ajoutés au classement général des pronos (points_ledger), attribués par
-- src/app/api/cron/quiz-season-bonus/route.ts le 1er janvier.
alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop',
  'season_final_team', 'season_final_winner',
  'midseason_malus',
  'quiz_season_bonus'
));
