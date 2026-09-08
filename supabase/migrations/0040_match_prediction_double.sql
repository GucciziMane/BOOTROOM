-- "x2" : une fois par journée ET par championnat, chacun choisit sur quel match de cette journée
-- doubler les points gagnés (score exact/bon résultat + buteur + passeur). Un seul x2 actif à la
-- fois par (utilisateur, championnat, journée) — appliqué/validé côté serveur dans
-- saveMatchPrediction (src/app/leagues/[code]/calendar/[matchId]/actions.ts), pas de contrainte
-- DB dédiée : la règle dépend de matches.league_id/matchday, pas seulement de cette table.

alter table public.match_predictions
  add column is_doubled boolean not null default false;
