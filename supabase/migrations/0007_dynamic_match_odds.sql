-- Cotes dynamiques sur les pronostics de match : le favori et l'ampleur de l'écart entre les
-- deux équipes sont recalculés à chaque sync (sync-fixtures) à partir du classement courant,
-- pour ajuster les points de score (un pronostic gagnant contre le favori rapporte plus qu'un
-- pronostic gagnant "logique"). Tant que le classement n'est pas assez fiable (début de
-- saison), favorite_team_id/odds_tier restent null et les points de base ne sont pas modifiés.

alter table public.matches
  add column favorite_team_id integer references public.teams (id),
  add column odds_tier smallint check (odds_tier between 1 and 5);

create table public.match_result_tier_multipliers (
  tier smallint primary key check (tier between 1 and 5),
  favorite_multiplier_pct integer not null, -- appliqué quand le pronostic gagnant est le favori
  underdog_multiplier_pct integer not null  -- appliqué quand le pronostic gagnant est l'outsider
);

insert into public.match_result_tier_multipliers (tier, favorite_multiplier_pct, underdog_multiplier_pct) values
  (1, 100, 100),
  (2, 90, 130),
  (3, 75, 160),
  (4, 60, 200),
  (5, 45, 260);

alter table public.match_result_tier_multipliers enable row level security;
create policy "reference data readable by authenticated users" on public.match_result_tier_multipliers for select to authenticated using (true);
