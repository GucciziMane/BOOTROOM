-- GIF Giphy dans le chat : gif_url stocke directement l'URL publique du média Giphy (CDN externe,
-- permanent, pas de signature nécessaire — contrairement à image_url qui pointe vers un CHEMIN
-- dans notre bucket privé "chat-images", voir migration 0030). Les deux restent des colonnes
-- séparées : un GIF n'a ni upload, ni bucket, ni règle "vue unique" (jamais éphémère).
--
-- (Tentative initiale avec Tenor, abandonnée : Google a gelé les nouvelles inscriptions à l'API
-- Tenor en janvier 2026 et l'a fermée depuis — 404 sur leur page d'enregistrement de clé.)

alter table public.chat_messages add column gif_url text;

alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check
  check (
    char_length(content) <= 2000
    and (char_length(content) > 0 or image_url is not null or gif_url is not null)
  );
