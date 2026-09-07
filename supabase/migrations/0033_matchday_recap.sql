-- Récap automatique de journée posté dans le chat par l'appli elle-même (meilleur/pire prono de
-- la journée, série en cours) : ces messages n'ont pas d'auteur humain, d'où user_id nullable et
-- le flag is_system pour les distinguer côté affichage (pas de bulle/avatar, style "bandeau").
alter table public.chat_messages alter column user_id drop not null;
alter table public.chat_messages add column is_system boolean not null default false;

-- Une ligne par (season_id, matchday) déjà récapée : empêche un double post si le cron retraite
-- le même lot de matchs, et sert d'historique pour calculer les séries ("3 journées de suite en
-- tête") d'une journée à l'autre.
create table public.matchday_recaps (
  id serial primary key,
  season_id integer not null references public.seasons (id) on delete cascade,
  league_id integer not null references public.leagues (id) on delete cascade,
  matchday integer not null,
  top_user_id uuid references auth.users (id) on delete set null,
  posted_at timestamptz not null default now(),
  unique (season_id, matchday)
);

alter table public.matchday_recaps enable row level security;
create policy "reference data readable by authenticated users" on public.matchday_recaps for select to authenticated using (true);
