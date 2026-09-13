-- Suppression d'un compte utilisateur (page admin) échouait avec "Database error deleting user" :
-- invite_codes.created_by/used_by et midseason_bonuses.target_user_id référencent auth.users sans
-- ON DELETE, bloquant toute suppression d'un utilisateur qui a créé/utilisé un code d'invitation ou
-- reçu un malus/cadeau de mi-saison (potentiellement tout le monde, l'appli étant sur invitation).
-- ON DELETE SET NULL (jamais CASCADE) : garde le code d'invitation/le bonus comme trace historique,
-- juste sans plus pointer vers un compte qui n'existe plus — même logique que matchday_recaps.top_user_id.

alter table public.invite_codes drop constraint invite_codes_created_by_fkey;
alter table public.invite_codes add constraint invite_codes_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.invite_codes drop constraint invite_codes_used_by_fkey;
alter table public.invite_codes add constraint invite_codes_used_by_fkey
  foreign key (used_by) references auth.users (id) on delete set null;

alter table public.midseason_bonuses drop constraint midseason_bonuses_target_user_id_fkey;
alter table public.midseason_bonuses add constraint midseason_bonuses_target_user_id_fkey
  foreign key (target_user_id) references auth.users (id) on delete set null;
