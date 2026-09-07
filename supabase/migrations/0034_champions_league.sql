-- Ajout de la Ligue des Champions comme 6e compétition suivie. Contrairement aux 5 championnats
-- actuels, ses clubs jouent aussi dans leur championnat domestique respectif — et football-data.org
-- attribue le MÊME id à un club dans toutes les compétitions où il apparaît. Le renommage de
-- colonne (migration 0002) n'a pas renommé les contraintes unique posées à la création de la table
-- (comportement standard Postgres) : elles portent encore le nom "api_football_id" et portaient sur
-- football_data_id SEUL, valable tant qu'aucun club n'était partagé entre deux compétitions suivies.
-- Sans ce correctif, la première synchro des équipes de Ligue des Champions aurait fait basculer
-- (upsert onConflict sur football_data_id) le league_id d'un club comme le Real Madrid depuis la
-- Liga vers la Ligue des Champions, le faisant disparaître du championnat domestique.
-- Recherche dynamique du nom réel de la contrainte plutôt qu'un nom deviné : un renommage de
-- colonne ne renomme pas la contrainte qui la couvre, donc son nom exact dépend de l'historique
-- exact de la table (potentiellement différent de la convention de nommage par défaut).
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.teams'::regclass and contype = 'u'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.teams'::regclass and attname = 'football_data_id')]
  loop
    execute format('alter table public.teams drop constraint %I', r.conname);
  end loop;

  for r in
    select conname from pg_constraint
    where conrelid = 'public.players'::regclass and contype = 'u'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.players'::regclass and attname = 'football_data_id')]
  loop
    execute format('alter table public.players drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.teams add constraint teams_league_football_data_id_key unique (league_id, football_data_id);
alter table public.players add constraint players_team_football_data_id_key unique (team_id, football_data_id);

-- Phase de ligue (matchdays 1-8) vs. élimination directe (barrages, 8es, 1/4, 1/2, finale) —
-- football-data.org expose ce champ ("REGULAR_SEASON" pour les 5 championnats domestiques,
-- "LEAGUE_STAGE"/"PLAYOFFS"/"LAST_16"/"QUARTER_FINALS"/"SEMI_FINALS"/"FINAL" pour la C1). Sert à
-- exclure les matchs à élimination directe du calcul de classement (une défaite en 1/4 ne doit pas
-- retirer de points au classement de la phase de ligue) — voir /calendar/classements/[code].
alter table public.matches add column stage text;

insert into public.leagues (name, country, football_data_id, football_data_code, highlightly_league_id, active, logo_url)
values ('Ligue des Champions', 'Europe', 2001, 'CL', 2486, true, 'https://crests.football-data.org/CL.png');
