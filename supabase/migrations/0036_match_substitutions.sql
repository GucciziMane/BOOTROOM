-- "Garantie buteur/passeur" : si le joueur pronostiqué buteur (ou passeur) est remplacé en cours
-- de match et que son remplaçant marque (ou délivre la passe décisive) à sa place, le pronostic
-- reste validé — voir process-scoring. Nécessite de savoir qui a remplacé qui, d'où cette table
-- (remplie via ESPN, seule source qui expose les événements de remplacement pour l'instant — voir
-- src/lib/espn/client.ts:getEspnMatchEvents).
create table public.match_substitutions (
  id serial primary key,
  match_id integer not null references public.matches (id) on delete cascade,
  team_id integer not null references public.teams (id),
  player_out_id integer references public.players (id),
  player_in_id integer references public.players (id),
  minute integer
);
create index match_substitutions_match_id_idx on public.match_substitutions (match_id);

alter table public.match_substitutions enable row level security;
create policy "reference data readable by authenticated users" on public.match_substitutions for select to authenticated using (true);
