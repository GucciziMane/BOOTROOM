-- Les effectifs football-data.org sont obsolètes (constaté : squads non rafraîchies depuis 2022).
-- On corrige à la main via Wikipédia ; ces joueurs n'ont pas d'identifiant football-data.org.
alter table public.players alter column football_data_id drop not null;
