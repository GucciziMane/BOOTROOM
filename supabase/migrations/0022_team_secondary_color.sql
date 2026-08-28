-- Deuxième couleur de l'identité du club (ex : RC Lens = rouge + or), pour un thème fidèle aux
-- clubs bicolores plutôt qu'une seule teinte plate.
alter table public.teams add column secondary_color text;
