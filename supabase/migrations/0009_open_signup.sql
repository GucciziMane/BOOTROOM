-- Inscription ouverte : email + mot de passe suffisent, plus besoin de code d'invitation.
-- La table invite_codes est conservée telle quelle (historique des codes déjà utilisés),
-- simplement plus jamais consultée par ce trigger.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := new.raw_user_meta_data ->> 'username';
begin
  insert into public.profiles (id, username)
    values (new.id, coalesce(v_username, split_part(new.email, '@', 1)));

  return new;
end;
$$;
