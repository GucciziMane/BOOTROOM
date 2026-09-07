-- Pronostic "finale" pour une coupe à élimination directe (Ligue des Champions) : les 2 clubs
-- qui s'affrontent + qui gagne, à la place du flop3/équipe surprise/équipe flop qui n'ont pas de
-- sens sans classement final. Résolu automatiquement depuis le match de stage "FINAL" de la
-- saison une fois joué (voir process-scoring), pas de saisie admin comme actual_surprise_team_id/
-- actual_flop_team_id.
alter table public.season_predictions
  add column final_team_a_id integer references public.teams (id),
  add column final_team_b_id integer references public.teams (id),
  add column final_winner_team_id integer references public.teams (id);

insert into public.point_config (key, points, description) values
  ('season_final_team', 40, 'Équipe finaliste correctement devinée (jusqu''à 2 par pronostic)'),
  ('season_final_winner', 60, 'Vainqueur de la finale correctement deviné');

alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop',
  'season_final_team', 'season_final_winner'
));
