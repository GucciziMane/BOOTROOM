-- Couleur dominante extraite du blason de chaque club (calculée une fois côté serveur, pas à
-- la volée dans le navigateur : crests.football-data.org n'envoie pas d'en-têtes CORS, donc une
-- extraction par canvas côté client échouerait silencieusement — impossible d'en lire les pixels).
alter table public.teams add column primary_color text;
