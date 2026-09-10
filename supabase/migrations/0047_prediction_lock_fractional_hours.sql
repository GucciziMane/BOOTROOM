-- match_prediction_lock_hours_before_kickoff passe de 1h à 15 min avant le coup d'envoi. La
-- fonction RLS match_prediction_lock_at (migration 0001) castait la valeur en ::int avant de la
-- multiplier par interval '1 hour' — un réglage fractionnaire comme '0.25' (15 min) aurait fait
-- échouer ce cast en erreur SQL, cassant du même coup toutes les policies insert/update/select de
-- match_predictions qui en dépendent. ::numeric accepte les fractions et multiplie correctement
-- un interval (0.25 * '1 hour' = '15 minutes'), sans changer le comportement pour une valeur
-- entière comme avant.

create or replace function public.match_prediction_lock_at(p_match_id integer)
returns timestamptz
language sql
stable
as $$
  select m.kickoff_at - (
    (select value from public.app_settings where key = 'match_prediction_lock_hours_before_kickoff')::numeric * interval '1 hour'
  )
  from public.matches m
  where m.id = p_match_id;
$$;

update public.app_settings set value = '0.25' where key = 'match_prediction_lock_hours_before_kickoff';
