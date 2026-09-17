-- La policy SELECT de la migration 0061 interrogeait ballon_dor_predictions DEPUIS sa propre
-- clause USING (EXISTS (select ... from ballon_dor_predictions mine ...)) : Postgres réapplique
-- cette même policy pour évaluer la sous-requête, qui réapplique la policy, etc. — erreur "42P17
-- infinite recursion detected in policy for relation ballon_dor_predictions" (vu en prod à
-- l'instant). Fonction SECURITY DEFINER (appartenant au propriétaire de la table, donc pas
-- soumise à RLS dessus, RLS non FORCÉE) pour sortir de la boucle : elle s'exécute avec les droits
-- du propriétaire, jamais ceux de l'appelant, donc jamais réévaluée par la policy qui l'appelle.
create or replace function public.has_submitted_ballon_dor(p_edition_year integer)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.ballon_dor_predictions
    where user_id = auth.uid() and edition_year = p_edition_year
  );
$$;

drop policy "own ballon dor prediction always visible, others after own subm" on public.ballon_dor_predictions;
create policy "own ballon dor prediction always visible, others after own submission or lock"
  on public.ballon_dor_predictions for select
  to authenticated
  using (
    auth.uid() = user_id
    or now() >= (select e.predictions_lock_at from public.ballon_dor_editions e where e.year = edition_year)
    or public.has_submitted_ballon_dor(edition_year)
  );
