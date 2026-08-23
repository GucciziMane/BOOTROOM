-- Chat de groupe unique entre tous les membres (pas de salons séparés, pas de messages privés).

create table public.chat_messages (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index chat_messages_created_at_idx on public.chat_messages (created_at);

alter table public.chat_messages enable row level security;

create policy "chat messages readable by any authenticated user"
  on public.chat_messages for select
  to authenticated
  using (true);

create policy "users can post their own chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Diffusion temps réel des nouveaux messages (Supabase Realtime).
alter publication supabase_realtime add table public.chat_messages;

-- Horodatage de dernière lecture, pour le badge "messages non lus" dans la nav.
alter table public.profiles add column chat_last_read_at timestamptz;
