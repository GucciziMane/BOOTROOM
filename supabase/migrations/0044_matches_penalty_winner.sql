-- O5 (penalties/tirs au but) : football-data.org confond dans score.fullTime le score du match
-- ET la séance de tirs au but éventuelle (fullTime = regularTime + extraTime + penalties, vérifié
-- en interrogeant l'API en direct sur des matchs réels de Ligue des Champions décidés aux tirs au
-- but) — matches.home_score/away_score stockaient donc un score gonflé et faux pour un tel match
-- (ex: 5-2 au lieu du vrai 1-0), et le vainqueur d'une finale décidée aux tirs au but n'était pas
-- déterminable séparément (season_final_winner, process-scoring). Voir sync-fixtures pour le
-- correctif du score lui-même (resolveMatchScore) : cette migration ajoute uniquement le
-- stockage du vainqueur aux tirs au but, jamais déduit du score.
--
-- Nullable : NULL pour l'écrasante majorité des matchs (tout match non décidé aux tirs au but).
-- Aucun index : cardinalité de valeurs non-NULL trop faible pour le justifier (quelques matchs
-- par saison au maximum). Aucun backfill : 0 match concerné en production au moment de cette
-- migration (vérifié en lecture avant conception — aucun match n'a encore de stage à élimination
-- directe).

alter table public.matches
  add column penalty_winner_team_id integer references public.teams (id);
