-- Symétrique du bonus mi-saison (migration 0049) : le bottom 3 du classement général au 26
-- décembre reçoit lui aussi un pouvoir à usage unique, mais inversé — offrir 100/75/50 points à un
-- joueur de son choix (la punition étant d'être forcé d'avantager un adversaire, pas une perte de
-- points pour celui qui offre : symétrique du malus, qui n'affecte pas non plus les points de
-- celui qui l'inflige). `kind` distingue les deux types de ligne dans la même table.
alter table public.midseason_bonuses
  add column kind text not null default 'malus' check (kind in ('malus', 'bonus'));

alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop',
  'season_final_team', 'season_final_winner',
  'midseason_malus',
  'quiz_season_bonus',
  'midseason_bonus_gift'
));
