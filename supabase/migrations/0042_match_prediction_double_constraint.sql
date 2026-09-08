-- Le boost x2 ("un seul match doublé par utilisateur/championnat/journée") n'était vérifié que
-- côté application (src/app/leagues/[code]/calendar/[matchId]/actions.ts, saveMatchPrediction),
-- en trois allers-retours non atomiques : deux requêtes concurrentes (double-tap, deux onglets)
-- peuvent chacune passer le contrôle "pas de x2 déjà actif" avant que l'autre n'ait committé,
-- laissant deux is_doubled = true actifs à la fois pour la même journée.
--
-- match_predictions ne stocke que match_id : la règle dépend d'une jointure vers matches
-- (league_id/matchday), qu'une contrainte UNIQUE native ne peut pas exprimer sans dénormaliser.
-- matches.matchday est recalculé à chaque synchronisation pour les tours à élimination directe
-- de la Ligue des Champions (valeur synthétique, cf. sync-fixtures/route.ts) : la dénormalisation
-- ci-dessous est donc maintenue par trigger plutôt que figée une fois pour toutes, pour ne jamais
-- diverger de matches si sa valeur est recalculée après coup.
--
-- Ce fichier est exécuté comme une seule transaction implicite (protocole "simple query" de
-- PostgreSQL sur un script multi-instructions) : si l'index unique final échoue parce que des
-- doublons is_doubled existent déjà en base, TOUT le fichier est annulé — aucune colonne ajoutée,
-- aucun trigger créé, retour exact à l'état précédent. Dans ce cas, exécuter d'abord
-- scripts/check-x2-duplicates.mjs pour identifier les lignes concernées et décider laquelle des
-- deux prédictions garde le x2 avant de relancer cette migration (cette décision n'est écrite
-- nulle part dans le code actuel — pas de règle implicite à deviner ici).
--
-- Aucune ligne de points_ledger n'est lue ni modifiée par cette migration : les points déjà
-- attribués pour un match déjà traité (matches.points_processed_at non nul) restent inchangés,
-- que ce match soit ou non concerné par un doublon historique.

alter table public.match_predictions
  add column league_id integer references public.leagues (id),
  add column matchday integer;

-- Backfill : recopie une valeur déjà stockée dans matches, ne modifie is_doubled/points_awarded
-- d'aucune ligne existante.
update public.match_predictions mp
set league_id = m.league_id, matchday = m.matchday
from public.matches m
where m.id = mp.match_id;

create or replace function public.set_match_prediction_matchday()
returns trigger
language plpgsql
as $$
begin
  select league_id, matchday into new.league_id, new.matchday
  from public.matches where id = new.match_id;
  return new;
end;
$$;

create trigger match_predictions_set_matchday
  before insert on public.match_predictions
  for each row execute function public.set_match_prediction_matchday();

-- security definer : doit pouvoir mettre à jour des match_predictions appartenant à d'autres
-- utilisateurs que l'appelant qui modifie matches (typiquement le rôle service de sync-fixtures),
-- ce que la RLS de match_predictions ("update own match predictions before lock") interdirait
-- sinon à un rôle qui ne bypass pas RLS.
create or replace function public.sync_match_predictions_matchday()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.match_predictions
  set league_id = new.league_id, matchday = new.matchday
  where match_id = new.id;
  return new;
end;
$$;

-- Le WHEN limite le déclenchement aux cas où la valeur change réellement : sync-fixtures ré-
-- upserte tous les matchs à chaque run, y compris ceux dont matchday/league_id ne changent pas.
create trigger matches_sync_prediction_matchday
  after update on public.matches
  for each row
  when (old.league_id is distinct from new.league_id or old.matchday is distinct from new.matchday)
  execute function public.sync_match_predictions_matchday();

-- Dernière étape : échoue (et annule tout le fichier, voir en-tête) s'il existe déjà, en base,
-- plus d'un is_doubled = true pour un même (user_id, league_id, matchday).
create unique index match_predictions_one_double_per_matchday
  on public.match_predictions (user_id, league_id, matchday)
  where is_doubled;
