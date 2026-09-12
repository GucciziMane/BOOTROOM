-- Incident du 12/09/2026 : plusieurs invocations concurrentes de live-tick (jusqu'à 6 en
-- parallèle observées via les logs QStash, une soirée à plusieurs matchs live en même temps)
-- dupliquaient buts et notifications de fin de match. Deux garde-fous complémentaires :

-- 1) Défense en profondeur contre un but réellement dupliqué en base (buteur résolu) même si deux
-- ticks se chevauchent malgré le correctif anti-chaînes multiples côté application (voir
-- LIVE_TICK_HEARTBEAT_STALE_MS). NULL sur player_id ou minute n'est jamais contraint par cette
-- unicité (sémantique standard Postgres, NULL <> NULL) : reste couvert par la dédup applicative
-- existante (Set par tick), pas de régression pour les buteurs non résolus/CSC.
alter table public.match_goals
  add constraint match_goals_match_player_minute_unique unique (match_id, player_id, minute);

-- 2) Notification "fin de match" envoyée une seule fois par match : sans ça, deux invocations
-- concurrentes qui lisent toutes les deux le même statut "live" avant qu'aucune n'ait commité son
-- update envoient chacune la leur. Réclamée atomiquement (UPDATE ... WHERE final_notified_at IS
-- NULL) : seule l'invocation qui gagne cette écriture notifie.
alter table public.matches add column final_notified_at timestamptz;
