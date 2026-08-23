-- Permet de retirer un championnat de l'affichage (prédictions, pronostics, classements)
-- sans supprimer les données déjà associées (pronostics existants, matchs, effectifs...).
alter table public.leagues add column active boolean not null default true;

update public.leagues set active = false where football_data_code = 'PPL';
