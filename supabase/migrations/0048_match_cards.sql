-- Cartons (jaune/rouge) par match, dans le même esprit que match_substitutions : source
-- ESPN/Highlightly (voir sync-fixtures), utilisée pour signaler dans le sélecteur buteur/passeur
-- un joueur récemment expulsé dans le dernier match de son équipe (voir MatchPredictionCard).
create table public.match_cards (
  id serial primary key,
  match_id integer not null references public.matches (id) on delete cascade,
  team_id integer not null references public.teams (id),
  player_id integer references public.players (id),
  card_type text not null check (card_type in ('yellow', 'red')),
  minute integer
);
create index match_cards_match_id_idx on public.match_cards (match_id);

alter table public.match_cards enable row level security;
create policy "reference data readable by authenticated users" on public.match_cards for select to authenticated using (true);
