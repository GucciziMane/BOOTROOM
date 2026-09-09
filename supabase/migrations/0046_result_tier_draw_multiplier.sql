-- Les nuls n'étaient jamais scalés par la cote (toujours la valeur de base, quel que soit
-- l'écart de niveau entre les deux équipes) — avec la refonte du barème victoire/nul (bon
-- résultat désormais scalé de façon bien plus marquée par tier), ça laissait un quart des
-- pronostics (les nuls) figés à une seule valeur, en plus de compresser l'essentiel des
-- variations sur les tiers 3-5, rares en pratique (la plupart des matchs sont tier 1-2 en
-- début de saison). Cette migration élargit l'écart entre tiers ET introduit une colonne dédiée
-- au nul, calée entre la valeur "favori" et la valeur "outsider" du même tier : un nul contre un
-- gros favori reste un petit exploit pour l'outsider, doit rapporter plus qu'un nul entre deux
-- équipes proches.

alter table public.match_result_tier_multipliers
  add column draw_multiplier_pct integer not null default 100;

update public.match_result_tier_multipliers set
  favorite_multiplier_pct = case tier
    when 1 then 110
    when 2 then 84
    when 3 then 58
    when 4 then 32
    when 5 then 6
  end,
  underdog_multiplier_pct = case tier
    when 1 then 140
    when 2 then 190
    when 3 then 260
    when 4 then 350
    when 5 then 460
  end,
  draw_multiplier_pct = case tier
    when 1 then 116
    when 2 then 136
    when 3 then 164
    when 4 then 200
    when 5 then 244
  end;
