-- Numéro de journée (matchday football-data.org), pour séparer visuellement les journées dans
-- le calendrier au lieu de ne grouper que par date.
alter table public.matches add column matchday integer;
