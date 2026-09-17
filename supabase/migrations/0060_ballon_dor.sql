-- Pronostic top 10 du Ballon d'Or 2026 : nouvelle fonctionnalité indépendante des pronostics de
-- match/saison existants. Les nominés (30, officiels, cérémonie le 26/10/2026 à Londres) jouent
-- pour des clubs hors du périmètre suivi par l'appli (Serie A, Al Nassr, Al-Qadsiah, Inter Miami,
-- et certains clubs de championnats suivis mais non synchronisés pour ce joueur précis) : table
-- dédiée `ballon_dor_nominees`, découplée de `players`/`teams`, plutôt que de forcer ce périmètre
-- à s'étendre pour une fonctionnalité ponctuelle et annuelle.
create table public.ballon_dor_nominees (
  id bigserial primary key,
  edition_year integer not null default 2026,
  name text not null,
  club_name text not null,
  -- Rempli après coup par un script one-off (API Wikipedia, même source que players.photo_url) —
  -- nullable : un nominé sans photo encore résolue reste utilisable (juste son nom affiché).
  photo_url text,
  display_order integer not null
);

-- Une ligne par édition annuelle (une seule pour l'instant : 2026) plutôt qu'une constante codée en
-- dur côté application — permet un futur "Ballon d'Or 2027" sans nouvelle migration de structure,
-- et le résultat réel (rank_*_nominee_id) est saisi ici par un simple `update` SQL une fois connu,
-- exactement comme season_predictions.actual_surprise_team_id/final_winner_team_id aujourd'hui.
create table public.ballon_dor_editions (
  id bigserial primary key,
  year integer not null unique,
  predictions_lock_at timestamptz not null,
  rank_1_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_2_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_3_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_4_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_5_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_6_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_7_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_8_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_9_nominee_id bigint references public.ballon_dor_nominees (id),
  rank_10_nominee_id bigint references public.ballon_dor_nominees (id),
  -- Posé une fois par le cron process-scoring une fois les 10 rangs renseignés (voir
  -- processBallonDor) : empêche un double paiement si le cron repasse dessus (30 min).
  points_processed_at timestamptz
);

create table public.ballon_dor_predictions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  edition_year integer not null references public.ballon_dor_editions (year),
  -- {"1": nominee_id, ..., "10": nominee_id} — même forme que season_predictions.top3/bottom3.
  picks jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, edition_year)
);

alter table public.ballon_dor_nominees enable row level security;
alter table public.ballon_dor_editions enable row level security;
alter table public.ballon_dor_predictions enable row level security;

create policy "ballon dor nominees are readable by any authenticated user"
  on public.ballon_dor_nominees for select
  to authenticated
  using (true);

create policy "ballon dor editions are readable by any authenticated user"
  on public.ballon_dor_editions for select
  to authenticated
  using (true);

-- Même modèle que season_predictions : sa propre ligne toujours visible, celle des autres
-- seulement une fois le verrouillage passé ; écriture seulement avant verrouillage.
create policy "own ballon dor prediction always visible"
  on public.ballon_dor_predictions for select
  to authenticated
  using (
    auth.uid() = user_id
    or now() >= (select e.predictions_lock_at from public.ballon_dor_editions e where e.year = edition_year)
  );

create policy "insert own ballon dor prediction before lock"
  on public.ballon_dor_predictions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and now() < (select e.predictions_lock_at from public.ballon_dor_editions e where e.year = edition_year)
  );

create policy "update own ballon dor prediction before lock"
  on public.ballon_dor_predictions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and now() < (select e.predictions_lock_at from public.ballon_dor_editions e where e.year = edition_year)
  );

alter table public.points_ledger drop constraint points_ledger_source_type_check;
alter table public.points_ledger add constraint points_ledger_source_type_check check (source_type in (
  'match_score', 'match_scorer', 'match_assist',
  'season_top_scorer', 'season_top_assist',
  'season_top3', 'season_bottom3',
  'season_surprise', 'season_flop',
  'season_final_team', 'season_final_winner',
  'midseason_malus',
  'quiz_season_bonus',
  'midseason_bonus_gift',
  'weekly_outsider_bonus',
  'ballon_dor'
));

-- Heure de verrouillage approximative (quelques heures avant la cérémonie annoncée ce soir-là) —
-- ajustable en un `update` si l'heure officielle précise diffère une fois connue.
insert into public.ballon_dor_editions (year, predictions_lock_at) values (2026, '2026-10-26T19:00:00Z');

-- Les 30 nominés officiels 2026, display_order = ordre officiel de l'annonce (voir recherche
-- croisée : ESPN, SI.com, Yahoo Sports, football-italia.net — jamais inventé).
insert into public.ballon_dor_nominees (edition_year, name, club_name, display_order) values
  (2026, 'Jude Bellingham', 'Real Madrid', 1),
  (2026, 'Pau Cubarsí', 'FC Barcelona', 2),
  (2026, 'Marc Cucurella', 'Real Madrid', 3),
  (2026, 'Ousmane Dembélé', 'Paris Saint-Germain', 4),
  (2026, 'Luis Díaz', 'Bayern Munich', 5),
  (2026, 'Bruno Fernandes', 'Manchester United', 6),
  (2026, 'Gabriel Magalhães', 'Arsenal', 7),
  (2026, 'Erling Haaland', 'Manchester City', 8),
  (2026, 'Achraf Hakimi', 'Paris Saint-Germain', 9),
  (2026, 'Harry Kane', 'Bayern Munich', 10),
  (2026, 'Khvicha Kvaratskhelia', 'Paris Saint-Germain', 11),
  (2026, 'Lamine Yamal', 'FC Barcelona', 12),
  (2026, 'Sadio Mané', 'Al Nassr', 13),
  (2026, 'Marquinhos', 'Paris Saint-Germain', 14),
  (2026, 'Lautaro Martínez', 'Inter Milan', 15),
  (2026, 'Kylian Mbappé', 'Real Madrid', 16),
  (2026, 'Nuno Mendes', 'Paris Saint-Germain', 17),
  (2026, 'Lionel Messi', 'Inter Miami', 18),
  (2026, 'João Neves', 'Paris Saint-Germain', 19),
  (2026, 'Michael Olise', 'Bayern Munich', 20),
  (2026, 'Willian Pacho', 'Paris Saint-Germain', 21),
  (2026, 'Julián Quiñones', 'Al-Qadsiah', 22),
  (2026, 'Declan Rice', 'Arsenal', 23),
  (2026, 'Rodri', 'FC Barcelona', 24),
  (2026, 'Fabián Ruiz', 'Paris Saint-Germain', 25),
  (2026, 'William Saliba', 'Arsenal', 26),
  (2026, 'Ferran Torres', 'Paris Saint-Germain', 27),
  (2026, 'Dayot Upamecano', 'Bayern Munich', 28),
  (2026, 'Vinícius Júnior', 'Real Madrid', 29),
  (2026, 'Vitinha', 'Paris Saint-Germain', 30);
