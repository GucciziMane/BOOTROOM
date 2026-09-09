-- Ouverture indéfinie des pronostics de saison (de nouveaux entrants continueront d'arriver) :
-- plus de date limite pour un PREMIER envoi, mais une fois enregistré, un pronostic de saison
-- n'est plus modifiable du tout (au lieu d'un verrouillage global par date pour tout le monde,
-- le verrouillage devient désormais individuel : "as-tu déjà enregistré, oui ou non").
--
-- season_predictions.season_id.predictions_lock_at (colonne seasons, inchangée) n'est donc plus
-- utilisée pour restreindre l'écriture ici — seule la policy SELECT existante continue de s'en
-- servir pour révéler les pronostics des autres une fois la date passée, comportement déjà en
-- place et non modifié par cette migration.

drop policy "insert own season predictions before lock" on public.season_predictions;
create policy "insert own season predictions once"
  on public.season_predictions for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Aucune policy UPDATE de remplacement : par défaut, RLS refuse toute modification une fois la
-- ligne créée (insert-only après le premier envoi).
drop policy "update own season predictions before lock" on public.season_predictions;
