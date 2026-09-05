-- matches.status est filtré partout (status='finished', status in ('scheduled','live')) sans
-- aucun index, toujours combiné à season_id (déjà indexé seul) : un composite couvre les deux
-- usages sans dupliquer l'index existant.
create index matches_season_id_status_idx on public.matches (season_id, status);

-- points_ledger est lu par (source_id, source_type) dans process-scoring, le classement et
-- l'historique de pronostics — seul user_id était indexé jusqu'ici.
create index points_ledger_source_idx on public.points_ledger (source_id, source_type);

-- match_predictions n'avait d'index que sur (user_id, match_id) (contrainte unique, user_id en
-- tête) : une recherche par match_id seul (calendrier, traitement des points) ne peut pas s'en
-- servir efficacement.
create index match_predictions_match_id_idx on public.match_predictions (match_id);
