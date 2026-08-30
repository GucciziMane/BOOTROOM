-- Filet de sécurité pour le double comptage des points : process-scoring insérait
-- une ligne points_ledger par (user, source_type, source_id) sans jamais vérifier
-- si elle existait déjà pour les matchs (contrairement au traitement de fin de
-- saison, qui le faisait). Si le cron plantait au milieu du traitement d'un
-- match, le prochain passage réinjectait les mêmes points. Le code applicatif
-- vérifie désormais les doublons avant d'insérer ; cette contrainte est un
-- filet de sécurité au niveau base au cas où deux exécutions se chevauchent.

-- Si le bug a déjà produit des doublons en prod, la contrainte échouerait à la
-- création : on nettoie d'abord en ne gardant que la ligne la plus ancienne de
-- chaque groupe (user_id, source_type, source_id).
delete from public.points_ledger a using public.points_ledger b
where a.user_id = b.user_id
  and a.source_type = b.source_type
  and a.source_id = b.source_id
  and a.id > b.id;

alter table public.points_ledger
  add constraint points_ledger_user_source_unique unique (user_id, source_type, source_id);
