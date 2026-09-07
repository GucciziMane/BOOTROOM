-- Cloche par match : plus de notif de but envoyée à tout le monde par défaut (trop de bruit pour
-- ceux qui ne suivent pas ce match précis) — chacun choisit, match par match, s'il veut être
-- notifié des buts de CE match. Muet par défaut, activé au tap sur la cloche.

create table public.match_goal_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id integer not null references public.matches (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);
create index match_goal_subscriptions_match_id_idx on public.match_goal_subscriptions (match_id);

alter table public.match_goal_subscriptions enable row level security;

create policy "users can manage their own goal subscriptions"
  on public.match_goal_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
