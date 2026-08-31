-- Permet d'envoyer une photo dans le chat, en plus ou à la place d'un texte. image_url pointe
-- vers le bucket "chat-images" (public en lecture, upload restreint à son propre dossier, même
-- schéma que le bucket "avatars"). Un message doit toujours contenir du texte OU une image.

alter table public.chat_messages add column image_url text;

alter table public.chat_messages alter column content set default '';
alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check
  check (char_length(content) <= 2000 and (char_length(content) > 0 or image_url is not null));

insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

create policy "chat images are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'chat-images');

create policy "users can upload their own chat images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);
