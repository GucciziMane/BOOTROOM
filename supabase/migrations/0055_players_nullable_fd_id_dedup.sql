-- football-data.org omet parfois l'id numérique de certains joueurs dans la réponse "squad" d'une
-- équipe (constaté sur 17 clubs de Ligue des Champions le 13/09/2026, 503 joueurs actifs concernés,
-- ex: Feyenoord, Napoli, Inter, Roma, Galatasaray) : ces lignes se retrouvent avec
-- football_data_id = null. La contrainte unique existante (team_id, football_data_id) — voir
-- migration 0034 — ne protège PAS ces lignes entre elles (NULL n'est jamais égal à NULL pour une
-- contrainte unique), donc l'UPSERT du prochain sync les insère en double au lieu de les mettre à
-- jour ; le nettoyage "marque parti" du même cron échoue aussi silencieusement dessus (NOT IN sur
-- une colonne nullable renvoie NULL, jamais TRUE, pour une ligne dont football_data_id est déjà
-- null — la condition WHERE ne matche donc jamais ces lignes). Sans repli, ces 503 joueurs
-- auraient doublé, sans limite, à chaque sync futur de Ligue des Champions.
--
-- Repli par (team_id, name) uniquement pour les lignes sans football_data_id — index partiel,
-- n'entre jamais en conflit avec la contrainte existante qui continue de couvrir les lignes ayant
-- un vrai id.
create unique index players_team_name_no_fd_id_key
  on public.players (team_id, name)
  where football_data_id is null;
