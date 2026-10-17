-- Highlightly (secours d'ESPN pour les buteurs/passeurs, 100 req/jour) était rappelé à chaque
-- passage de sync-fixtures (~144/jour) pour tout match introuvable sur ESPN, épuisant le quota
-- chaque jour. events_hl_attempted_at borne les tentatives par match ; events_sync_alerted_at
-- garantit une seule alerte admin par match resté sans buteurs (remplace l'alerte "quota").
alter table public.matches add column if not exists events_hl_attempted_at timestamptz;
alter table public.matches add column if not exists events_sync_alerted_at timestamptz;
