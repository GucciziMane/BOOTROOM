-- PostgREST plafonne chaque requête à 1000 lignes par défaut (db_max_rows). Plusieurs
-- requêtes de l'app dépassent déjà ce plafond (ex : les joueurs de tous les championnats
-- actifs = ~2600 lignes, les matchs à venir = ~1600 lignes), ce qui tronquait silencieusement
-- les résultats — c'est la cause du bug "il manque des joueurs" (ex : Nottingham Forest
-- n'affichait que les joueurs dont le nom tombait dans les 1000 premières lignes triées).
-- On relève la limite à un seuil confortable plutôt que de rustiner chaque requête une par une.
alter role authenticator set pgrst.db_max_rows = '10000';
notify pgrst, 'reload config';
