-- Un but marqué par un joueur absent de notre effectif synchronisé (transfert tout juste arrivé
-- que football-data.org n'a pas encore répertorié, ou but contre son camp — les deux finissaient
-- par échouer la même recherche par nom dans le mauvais effectif) était jusqu'ici silencieusement
-- ignoré : ni affiché en direct, ni compté dans le score détaillé. On garde maintenant le nom brut
-- fourni par la source (ESPN/football-data.org) même quand il ne correspond à aucun joueur connu,
-- pour au moins l'afficher — un but sans player_id ne peut de toute façon compter pour aucun
-- pronostic buteur/passeur, puisque ce joueur n'a jamais pu être proposé dans la liste au moment
-- du pronostic.

alter table public.match_goals
  add column scorer_name text,
  add column assist_name text;
