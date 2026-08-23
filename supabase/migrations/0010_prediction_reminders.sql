-- Rappels par email envoyés ~24-48h avant chaque deadline (pronostic de match ou prédiction
-- de saison) à ceux qui n'ont pas encore soumis. Ce log évite de relancer deux fois la même
-- deadline pour un même utilisateur (le cron tourne une fois par jour sur une fenêtre glissante).

create table public.reminder_log (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('match', 'season')),
  source_id integer not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, source_id)
);

alter table public.reminder_log enable row level security;
-- Aucune policy : uniquement le service role (cron de rappels) lit/écrit cette table.
