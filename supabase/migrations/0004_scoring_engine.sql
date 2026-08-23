-- Moteur de scoring : classement final calculé à partir des matchs (pas de sync standings
-- séparée), buteur/passeur de saison calculés à partir de match_goals. L'équipe surprise/flop
-- reste une décision subjective : l'admin renseigne le vrai résultat à la main en fin de
-- saison (actual_surprise_team_id / actual_flop_team_id), le moteur se contente de comparer
-- aux pronostics une fois ces colonnes renseignées.

alter table public.seasons
  add column actual_surprise_team_id integer references public.teams (id),
  add column actual_flop_team_id integer references public.teams (id),
  add column points_processed_at timestamptz;
