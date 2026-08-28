-- Réactions emoji sur les messages du chat (façon Instagram DM) : une seule réaction par
-- utilisateur et par message — en choisir une nouvelle remplace la précédente.

create table public.chat_message_reactions (
  id bigserial primary key,
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);
create index chat_message_reactions_message_id_idx on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;

create policy "reactions readable by any authenticated user"
  on public.chat_message_reactions for select
  to authenticated
  using (true);

create policy "users can manage their own reactions"
  on public.chat_message_reactions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Diffusion temps réel des réactions (Supabase Realtime), comme pour les messages eux-mêmes.
alter publication supabase_realtime add table public.chat_message_reactions;
