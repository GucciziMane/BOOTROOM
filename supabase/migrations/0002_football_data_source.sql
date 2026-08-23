-- Bascule vers football-data.org comme source principale (équipes/effectifs/calendrier/
-- résultats/classements), sans restriction de saison sur son plan gratuit. API-Football
-- reste utilisé uniquement pour les events but/passe de chaque match, via une recherche
-- par date qui contourne la restriction de saison de son propre plan gratuit.

alter table public.leagues
  add column football_data_id integer,
  add column football_data_code text;

update public.leagues set football_data_id = 2015, football_data_code = 'FL1' where api_football_id = 61;
update public.leagues set football_data_id = 2021, football_data_code = 'PL'  where api_football_id = 39;
update public.leagues set football_data_id = 2014, football_data_code = 'PD'  where api_football_id = 140;
update public.leagues set football_data_id = 2002, football_data_code = 'BL1' where api_football_id = 78;
update public.leagues set football_data_id = 2017, football_data_code = 'PPL' where api_football_id = 94;

alter table public.leagues
  alter column football_data_id set not null,
  alter column football_data_code set not null,
  add constraint leagues_football_data_id_key unique (football_data_id),
  add constraint leagues_football_data_code_key unique (football_data_code);

comment on column public.leagues.api_football_id is 'ID championnat côté API-Football, utilisé uniquement pour retrouver les events but/passe des matchs';
comment on column public.leagues.football_data_id is 'ID championnat côté football-data.org, source principale (équipes/calendrier/résultats/classements)';

alter table public.teams rename column api_football_id to football_data_id;
alter table public.players rename column api_football_id to football_data_id;
alter table public.matches rename column api_football_id to football_data_id;

-- Évite de re-requêter les events API-Football pour un match déjà traité.
alter table public.matches add column events_synced_at timestamptz;

-- Un event "Goal" d'API-Football porte à la fois le buteur et le passeur.
alter table public.match_goals add column assist_player_id integer references public.players (id);
