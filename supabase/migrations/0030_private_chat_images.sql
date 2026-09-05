-- Le bucket "chat-images" était public en lecture (0026) : même pour une photo "éphémère"
-- (visible une seule fois par destinataire, 0027), l'URL publique restait valable indéfiniment
-- pour QUICONQUE l'aurait capturée une fois (devtools réseau, cache navigateur) — y compris sans
-- être connecté à l'app. Le mécanisme "vue une fois" n'existait qu'en apparence côté client.
--
-- Le bucket passe privé : chat_messages.image_url stockera désormais le CHEMIN de stockage
-- (plus une URL publique fixe), et le serveur ne délivre jamais qu'une URL signée à courte durée
-- de vie (60s, cf. src/app/chat/actions.ts:getChatImageUrl), générée à la demande. Pour une photo
-- éphémère, cette fonction refuse d'en générer une seconde une fois la vue déjà enregistrée dans
-- chat_message_views — l'application impose donc réellement la règle "une seule vue", la policy
-- de stockage ci-dessous n'ayant qu'à vérifier l'appartenance au groupe (authenticated).

update storage.buckets set public = false where id = 'chat-images';

drop policy if exists "chat images are publicly readable" on storage.objects;

create policy "chat images readable by authenticated users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-images');
