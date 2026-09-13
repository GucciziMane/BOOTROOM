-- Répondre à un message précis du chat (sélection par appui long/glissement côté client) : garde
-- juste une référence vers le message d'origine, jamais de copie de son contenu (toujours résolu
-- à l'affichage, depuis les messages déjà chargés côté client ou par une lecture ciblée sinon).
-- on delete set null (pas cascade) : si le message d'origine venait à disparaître, la réponse
-- reste lisible (juste sans le rappel du message cité) plutôt que d'être supprimée avec lui.
alter table public.chat_messages add column reply_to_id bigint references public.chat_messages (id) on delete set null;
