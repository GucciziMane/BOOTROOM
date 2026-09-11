-- Bonus mi-saison (26 décembre) : le top 3 du classement général reçoit chacun un malus à usage
-- unique (-100/-75/-50 points) à infliger au joueur de leur choix avant le 1er janvier, et un
-- trophée permanent affiché à côté de leur nom (classement + profil), qu'ils l'utilisent ou non.
-- Attribution automatique par cron (src/app/api/cron/midseason-bonus/route.ts), usage via server
-- action (src/app/leaderboard/actions.ts) — les deux passent par le service role, jamais le client.
create table public.midseason_bonuses (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  season_year integer not null, -- année d'attribution (2026 pour le 26/12/2026)
  rank integer not null check (rank in (1, 2, 3)),
  amount integer not null check (amount in (100, 75, 50)),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null, -- 1er janvier suivant, 00:00 UTC
  used_at timestamptz,
  target_user_id uuid references auth.users (id),
  unique (user_id, season_year) -- filet anti double-attribution si le cron est rejoué
);
create index midseason_bonuses_user_id_idx on public.midseason_bonuses (user_id);

alter table public.midseason_bonuses enable row level security;

-- Même modèle que points_ledger : lecture publique (nécessaire pour afficher le trophée de TOUS
-- les joueurs sur le classement, pas juste le sien), aucune écriture cliente.
create policy "midseason bonuses are readable by any authenticated user"
  on public.midseason_bonuses for select
  to authenticated
  using (true);

-- Nouveau source_type pour le malus lui-même dans points_ledger (league_id restera null : le
-- malus touche le classement général, jamais un classement par championnat).
alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop',
  'season_final_team', 'season_final_winner',
  'midseason_malus'
));
