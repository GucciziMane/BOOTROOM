-- Bascule entre le thème de base de l'app et un thème teinté de la couleur du club favori.
alter table public.profiles add column use_club_theme boolean not null default false;
