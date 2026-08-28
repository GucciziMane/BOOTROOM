-- Club favori choisi par chaque utilisateur (affiché en badge sur son avatar).
alter table public.profiles add column favorite_team_id integer references public.teams (id);
