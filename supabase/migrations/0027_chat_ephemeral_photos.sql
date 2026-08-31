-- Photos "à la Snapchat" prises directement avec l'appareil photo depuis le chat (pas celles
-- choisies dans la pellicule, qui restent des photos classiques persistantes) : visibles une
-- seule fois par destinataire, puis remplacées par un indicateur "vue". L'expéditeur voit
-- toujours sa propre photo normalement (chat_message_views ne le concerne pas).

alter table public.chat_messages add column is_ephemeral boolean not null default false;

create table public.chat_message_views (
  id bigserial primary key,
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.chat_message_views enable row level security;

create policy "users can read their own view records"
  on public.chat_message_views for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can record their own views"
  on public.chat_message_views for insert
  to authenticated
  with check (auth.uid() = user_id);
