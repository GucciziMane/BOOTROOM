-- Phase 2.6 (P1) : match_predictions.league_id/matchday n'étaient réécrites depuis matches qu'à
-- l'INSERT (trigger match_predictions_set_matchday, migration 0042). Aucun trigger BEFORE UPDATE
-- n'existait : la policy RLS "update own match predictions before lock" (migration 0001) ne
-- restreint que la ligne (auth.uid() = user_id) et le timing (now() < lock_at), jamais les
-- colonnes — un utilisateur authentifié pouvait donc, via un appel direct à l'API REST (en
-- contournant saveMatchPrediction), écrire league_id/matchday à des valeurs fabriquées sur un
-- UPDATE. Chaque ligne fabriquée devient alors "unique" par construction pour l'index
-- match_predictions_one_double_per_matchday (migration 0042), qui ne peut plus rien bloquer :
-- contournement complet de la règle "un seul x2 actif par (utilisateur, championnat, journée)".
--
-- Correctif : un trigger BEFORE UPDATE symétrique à celui d'INSERT, qui réécrase
-- systématiquement NEW.league_id/NEW.matchday depuis matches à CHAQUE update de
-- match_predictions — quelle que soit la colonne réellement modifiée (is_doubled, score
-- pronostiqué, ou même match_id lui-même) : la valeur envoyée par le client, quelle qu'elle soit,
-- est toujours écrasée par celle de matches avant écriture.
--
-- Pas de SECURITY DEFINER : matches a une policy SELECT ouverte à tout utilisateur authentifié
-- ("reference data readable by authenticated users", migration 0001) — le rôle appelant a donc
-- déjà le droit de lire la ligne nécessaire, pas besoin d'élever les privilèges (principe de
-- moindre privilège), exactement comme le trigger d'INSERT existant ne l'utilise pas non plus
-- pour la même raison.
--
-- Si NEW.match_id ne référence aucun match existant, l'opération échoue explicitement avec un
-- message clair plutôt que d'écrire des league_id/matchday NULL ou hérités de l'ancienne ligne
-- (la contrainte de clé étrangère sur match_id aurait de toute façon fini par bloquer l'update,
-- mais avec un message Postgres générique et après ce trigger).
--
-- N'affecte pas : la policy RLS existante (aucune n'est modifiée ici), la règle de verrouillage
-- (match_prediction_lock_at, inchangée), le scoring (process-scoring ne lit que
-- is_doubled/points_awarded, jamais league_id/matchday), ni l'index unique
-- match_predictions_one_double_per_matchday (inchangé, toujours actif et toujours efficace —
-- c'est justement ce que ce trigger rend à nouveau vrai pour la voie UPDATE).

create or replace function public.set_match_prediction_matchday_on_update()
returns trigger
language plpgsql
as $$
declare
  v_league_id integer;
  v_matchday integer;
begin
  select league_id, matchday into v_league_id, v_matchday
  from public.matches
  where id = new.match_id;

  if not found then
    raise exception 'match_predictions.match_id % does not reference an existing match', new.match_id
      using errcode = 'foreign_key_violation';
  end if;

  new.league_id := v_league_id;
  new.matchday := v_matchday;
  return new;
end;
$$;

create trigger match_predictions_set_matchday_on_update
  before update on public.match_predictions
  for each row execute function public.set_match_prediction_matchday_on_update();
