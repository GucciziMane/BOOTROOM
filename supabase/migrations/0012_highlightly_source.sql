-- API-Football a retiré son plan gratuit (compte suspendu tant qu'aucun abonnement payant
-- n'est actif). Bascule vers Highlightly (soccer.highlightly.net) pour les events but/passe :
-- même rôle qu'API-Football (uniquement les events, football-data.org reste la source
-- principale), plan gratuit 100 req/jour sans carte bancaire.

alter table public.leagues rename column api_football_id to highlightly_league_id;

update public.leagues set highlightly_league_id = 52695  where name = 'Ligue 1';
update public.leagues set highlightly_league_id = 33973  where name = 'Premier League';
update public.leagues set highlightly_league_id = 119924 where name = 'La Liga';
update public.leagues set highlightly_league_id = 67162  where name = 'Bundesliga';
update public.leagues set highlightly_league_id = 80778  where name = 'Primeira Liga';

comment on column public.leagues.highlightly_league_id is 'ID championnat côté Highlightly, utilisé uniquement pour retrouver les events but/passe des matchs';
