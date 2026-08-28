-- Web Push : une notification système même onglet/navigateur fermé, tant que le navigateur
-- tourne en arrière-plan (contrairement à la simple Notification API qui exige un onglet ouvert).
-- Un même utilisateur peut avoir plusieurs souscriptions (plusieurs appareils/navigateurs).

create table public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "users can manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
