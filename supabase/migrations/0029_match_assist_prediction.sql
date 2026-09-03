-- Pronostic "passeur décisif", en miroir du système buteur existant : même mécanique (choix d'un
-- joueur, bonus selon son tier de probabilité recalculé à chaque sync), sur une donnée déjà
-- collectée (match_goals.assist_player_id existe depuis la sync ESPN des buteurs) mais jamais
-- exploitée côté pronostics jusqu'ici.

alter table public.match_predictions add column predicted_assist_player_id integer references public.players (id);

create table public.player_assist_tier (
  id serial primary key,
  player_id integer not null references public.players (id) on delete cascade,
  season_id integer not null references public.seasons (id) on delete cascade,
  tier smallint not null check (tier between 1 and 5), -- 1 = très probable passeur, 5 = très improbable
  assists_per_90 numeric,
  computed_at timestamptz not null default now(),
  unique (player_id, season_id)
);

-- Points passeur pronostiqué sur un match, par tier de probabilité. Valeurs plus basses qu'au
-- barème buteur (match_scorer_tier_points) : une passe décisive rapporte traditionnellement moins
-- qu'un but dans ce genre de barème, ajustable ensuite sans redéploiement comme les autres tables.
create table public.match_assist_tier_points (
  tier smallint primary key check (tier between 1 and 5),
  points integer not null
);
insert into public.match_assist_tier_points (tier, points) values
  (1, 10), (2, 18), (3, 28), (4, 42), (5, 65);

alter table public.player_assist_tier enable row level security;
alter table public.match_assist_tier_points enable row level security;

create policy "reference data readable by authenticated users" on public.player_assist_tier for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.match_assist_tier_points for select to authenticated using (true);

alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop'
));
