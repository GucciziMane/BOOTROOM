-- sync-teams-players s'est fait couper par le plafond de durée de la plateforme en essayant de
-- traiter les 6 compétitions dans une seule invocation avec le rythme d'appels imposé par le plan
-- gratuit football-data.org (jamais un problème avant l'ajout de la Ligue des Champions comme 6e
-- compétition). Plutôt que de tout traiter d'un coup, chaque run ne traite plus qu'un petit lot,
-- en commençant par la compétition la moins récemment resynchronisée — voir
-- /api/cron/sync-teams-players. Sur plusieurs runs rapprochés (cron quotidien désormais, cf.
-- vercel.json), tout le monde finit par y passer sans jamais risquer le timeout.
alter table public.leagues add column roster_synced_at timestamptz;
