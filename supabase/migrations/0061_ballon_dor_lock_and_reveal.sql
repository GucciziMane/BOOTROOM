-- Deux changements demandés :
-- 1. "Une fois validé, le classement ne peut plus être modifié" : verrouillage individuel dès le
--    premier envoi (pas seulement à la date limite globale) — même pattern que
--    supabase/migrations/0045_season_predictions_open_immutable.sql pour season_predictions. Le
--    premier envoi reste borné par predictions_lock_at (INSERT inchangé, voir migration 0060) :
--    contrairement à season_predictions, un résultat réel public existe ici (cérémonie du
--    26/10), donc pas question d'autoriser un premier envoi après cette date.
-- 2. La liste des pronostics des autres devient visible dès que J'AI MOI-MÊME déjà validé le
--    mien (pas seulement une fois la date de verrouillage globale passée) — encourage à valider
--    le sien avant de pouvoir regarder celui des autres, plutôt que d'attendre la cérémonie.

drop policy "update own ballon dor prediction before lock" on public.ballon_dor_predictions;
-- Aucune policy UPDATE de remplacement : RLS refuse par défaut toute modification une fois la
-- ligne créée.

drop policy "own ballon dor prediction always visible" on public.ballon_dor_predictions;
create policy "own ballon dor prediction always visible, others after own submission or lock"
  on public.ballon_dor_predictions for select
  to authenticated
  using (
    auth.uid() = user_id
    or now() >= (select e.predictions_lock_at from public.ballon_dor_editions e where e.year = edition_year)
    or exists (
      select 1 from public.ballon_dor_predictions mine
      where mine.user_id = auth.uid() and mine.edition_year = ballon_dor_predictions.edition_year
    )
  );
