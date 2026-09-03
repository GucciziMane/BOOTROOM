-- Le sync hebdo (sync-teams-players) n'a jamais retiré un joueur parti au mercato : il upsert
-- les arrivants mais ne supprimait jamais les rows absentes de la réponse football-data.org,
-- donc un effectif ne faisait que grossir avec le temps. On ne peut pas juste DELETE ces joueurs
-- (certains sont référencés par des buts/pronostics passés — perdre l'historique), donc on les
-- marque "parti" au lieu de les effacer, et les écrans qui affichent l'effectif ACTUEL filtrent
-- sur left_at is null.

alter table public.players add column left_at timestamptz;
