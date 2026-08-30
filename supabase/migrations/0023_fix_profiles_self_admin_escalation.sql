-- Faille : la policy UPDATE de profiles ne restreignait aucune colonne, donc
-- n'importe quel utilisateur authentifié pouvait faire
--   supabase.from('profiles').update({ is_admin: true }).eq('id', auth.uid())
-- et devenir admin lui-même. Combiné à l'inscription publique (0009), n'importe
-- qui pouvait créer un compte, se promouvoir admin, puis supprimer les autres
-- comptes via /admin.
--
-- Le sous-select ci-dessous voit la valeur de is_admin AVANT la mise à jour en
-- cours (un UPDATE prend un seul snapshot MVCC pour toute la commande), donc
-- il bloque tout changement de is_admin par un client authentifié classique.
-- Le rôle postgres (SQL editor) et service_role (createServiceRoleClient côté
-- serveur) contournent RLS comme avant : pour promouvoir un admin, passer par
-- le SQL editor Supabase, pas par le client.

drop policy "users can update their own profile" on public.profiles;

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
  );
