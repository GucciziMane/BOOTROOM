-- App Foot — schéma initial
-- Jeu de pronostics privé (5 comptes max) sur les 5 grands championnats européens.

-- ============================================================================
-- PROFILS (liés à auth.users)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ============================================================================
-- INVITE CODES — inscription fermée, uniquement via code à usage unique
-- ============================================================================

create table public.invite_codes (
  code text primary key,
  created_by uuid references auth.users (id),
  used_by uuid references auth.users (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
-- Aucune policy publique : la validation se fait côté serveur (service role) uniquement.

-- ============================================================================
-- DONNÉES DE RÉFÉRENCE (synchronisées via API-Football, écrites en service role)
-- ============================================================================

create table public.leagues (
  id serial primary key,
  name text not null,
  country text not null,
  api_football_id integer not null unique,
  logo_url text
);

create table public.teams (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  name text not null,
  api_football_id integer not null unique,
  logo_url text
);
create index teams_league_id_idx on public.teams (league_id);

create table public.players (
  id serial primary key,
  team_id integer not null references public.teams (id) on delete cascade,
  name text not null,
  position text not null check (position in ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker')),
  api_football_id integer not null unique,
  photo_url text,
  updated_at timestamptz not null default now()
);
create index players_team_id_idx on public.players (team_id);

create table public.seasons (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  year integer not null,
  start_date date not null,
  end_date date,
  predictions_lock_at timestamptz not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'in_progress', 'finished')),
  unique (league_id, year)
);

create table public.matches (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  season_id integer not null references public.seasons (id) on delete cascade,
  api_football_id integer not null unique,
  home_team_id integer not null references public.teams (id),
  away_team_id integer not null references public.teams (id),
  kickoff_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_score integer,
  away_score integer,
  points_processed_at timestamptz
);
create index matches_season_id_idx on public.matches (season_id);
create index matches_kickoff_at_idx on public.matches (kickoff_at);

create table public.match_goals (
  id serial primary key,
  match_id integer not null references public.matches (id) on delete cascade,
  team_id integer not null references public.teams (id),
  player_id integer references public.players (id),
  minute integer
);
create index match_goals_match_id_idx on public.match_goals (match_id);

-- Tier de probabilité de marquer, recalculé périodiquement (poste + forme récente)
create table public.player_scoring_tier (
  id serial primary key,
  player_id integer not null references public.players (id) on delete cascade,
  season_id integer not null references public.seasons (id) on delete cascade,
  tier smallint not null check (tier between 1 and 5), -- 1 = très probable, 5 = très improbable
  goals_per_90 numeric,
  computed_at timestamptz not null default now(),
  unique (player_id, season_id)
);

-- ============================================================================
-- BARÈME DE POINTS — table de constantes, ajustable sans redéploiement
-- ============================================================================

create table public.point_config (
  key text primary key,
  points integer not null,
  description text
);

insert into public.point_config (key, points, description) values
  ('match_exact_score', 30, 'Score exact trouvé'),
  ('match_correct_result_no_score', 10, 'Bon vainqueur/nul sans le score exact'),
  ('season_position_exact', 50, 'Équipe placée à la position exacte (top3/flop3)'),
  ('season_position_presence', 15, 'Équipe présente dans le trio mais mauvaise position'),
  ('season_surprise_team', 40, 'Équipe surprise correctement devinée'),
  ('season_flop_team', 40, 'Équipe flop correctement devinée');

-- Points buteur pronostiqué sur un match, par tier de probabilité (1=probable -> 5=improbable)
create table public.match_scorer_tier_points (
  tier smallint primary key check (tier between 1 and 5),
  points integer not null
);
insert into public.match_scorer_tier_points (tier, points) values
  (1, 15), (2, 25), (3, 40), (4, 60), (5, 90);

-- Points buteur/passeur de la saison, par tier calculé en début de saison
create table public.season_top_player_tier_points (
  tier smallint primary key check (tier between 1 and 5),
  points integer not null
);
insert into public.season_top_player_tier_points (tier, points) values
  (1, 60), (2, 100), (3, 150), (4, 220), (5, 300);

-- Nombre d'heures avant le coup d'envoi où un pronostic de match est verrouillé
create table public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  ('match_prediction_lock_hours_before_kickoff', '1');

-- ============================================================================
-- PRONOSTICS DE SAISON
-- ============================================================================

create table public.season_predictions (
  id serial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id integer not null references public.seasons (id) on delete cascade,
  top_scorer_player_id integer references public.players (id),
  top_assist_player_id integer references public.players (id),
  top3 jsonb not null default '{}', -- {"1": team_id, "2": team_id, "3": team_id}
  bottom3 jsonb not null default '{}',
  surprise_team_id integer references public.teams (id),
  flop_team_id integer references public.teams (id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, season_id)
);

alter table public.season_predictions enable row level security;

create policy "own season predictions always visible"
  on public.season_predictions for select
  to authenticated
  using (
    auth.uid() = user_id
    or now() >= (select s.predictions_lock_at from public.seasons s where s.id = season_id)
  );

create policy "insert own season predictions before lock"
  on public.season_predictions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and now() < (select s.predictions_lock_at from public.seasons s where s.id = season_id)
  );

create policy "update own season predictions before lock"
  on public.season_predictions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and now() < (select s.predictions_lock_at from public.seasons s where s.id = season_id)
  );

-- ============================================================================
-- PRONOSTICS DE MATCH (score + buteur)
-- ============================================================================

create table public.match_predictions (
  id serial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id integer not null references public.matches (id) on delete cascade,
  predicted_home_score smallint not null,
  predicted_away_score smallint not null,
  predicted_scorer_player_id integer references public.players (id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  points_awarded integer,
  unique (user_id, match_id)
);

alter table public.match_predictions enable row level security;

create or replace function public.match_prediction_lock_at(p_match_id integer)
returns timestamptz
language sql
stable
as $$
  select m.kickoff_at - (
    (select value from public.app_settings where key = 'match_prediction_lock_hours_before_kickoff')::int * interval '1 hour'
  )
  from public.matches m
  where m.id = p_match_id;
$$;

create policy "own match predictions always visible, others visible once locked"
  on public.match_predictions for select
  to authenticated
  using (
    auth.uid() = user_id
    or now() >= public.match_prediction_lock_at(match_id)
  );

create policy "insert own match predictions before lock"
  on public.match_predictions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and now() < public.match_prediction_lock_at(match_id)
  );

create policy "update own match predictions before lock"
  on public.match_predictions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and now() < public.match_prediction_lock_at(match_id)
  );

-- ============================================================================
-- LEDGER DE POINTS — alimente le leaderboard, écrit uniquement par le moteur de scoring
-- ============================================================================

create table public.points_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  league_id integer references public.leagues (id),
  source_type text not null check (source_type in (
    'match_score', 'match_scorer',
    'season_top_scorer', 'season_top_assist',
    'season_top3', 'season_bottom3',
    'season_surprise', 'season_flop'
  )),
  source_id integer not null, -- match_id ou season_id selon source_type
  points integer not null,
  created_at timestamptz not null default now()
);
create index points_ledger_user_id_idx on public.points_ledger (user_id);

alter table public.points_ledger enable row level security;

create policy "points ledger is readable by any authenticated user"
  on public.points_ledger for select
  to authenticated
  using (true);

-- Pas de policy insert/update/delete : uniquement le service role (moteur de scoring) peut écrire.

-- ============================================================================
-- REFERENCE DATA — lecture publique (authenticated), écriture service role uniquement
-- ============================================================================

alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.seasons enable row level security;
alter table public.matches enable row level security;
alter table public.match_goals enable row level security;
alter table public.player_scoring_tier enable row level security;
alter table public.point_config enable row level security;
alter table public.match_scorer_tier_points enable row level security;
alter table public.season_top_player_tier_points enable row level security;
alter table public.app_settings enable row level security;

create policy "reference data readable by authenticated users" on public.leagues for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.teams for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.players for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.seasons for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.matches for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.match_goals for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.player_scoring_tier for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.point_config for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.match_scorer_tier_points for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.season_top_player_tier_points for select to authenticated using (true);
create policy "reference data readable by authenticated users" on public.app_settings for select to authenticated using (true);

-- ============================================================================
-- INSCRIPTION : création du profil à la création du compte auth, via code d'invitation
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := new.raw_user_meta_data ->> 'invite_code';
  v_username text := new.raw_user_meta_data ->> 'username';
begin
  if v_code is null then
    raise exception 'invite_code manquant';
  end if;

  update public.invite_codes
    set used_by = new.id, used_at = now()
    where code = v_code and used_by is null;

  if not found then
    raise exception 'code d''invitation invalide ou déjà utilisé';
  end if;

  insert into public.profiles (id, username)
    values (new.id, coalesce(v_username, split_part(new.email, '@', 1)));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- SEED — les 5 championnats (identifiants API-Football)
-- ============================================================================

insert into public.leagues (name, country, api_football_id) values
  ('Ligue 1', 'France', 61),
  ('Premier League', 'England', 39),
  ('La Liga', 'Spain', 140),
  ('Bundesliga', 'Germany', 78),
  ('Primeira Liga', 'Portugal', 94);
