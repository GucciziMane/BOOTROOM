-- Minute affichée pendant qu'un match est "live" (ex: "63'", "45'+2'"), pour l'affichage en
-- direct dans l'appli — voir /api/cron/live-tick. Jamais utilisé pour un calcul, uniquement
-- affiché tel quel, d'où le type text plutôt qu'un entier de minutes.
alter table public.matches add column live_clock text;
