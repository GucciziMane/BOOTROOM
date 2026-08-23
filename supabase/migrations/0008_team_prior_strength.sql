-- Force historique de l'équipe (points/match de la saison précédente dans cette compétition,
-- ou repli sur le niveau de la lanterne rouge si promue) : permet de désigner un favori dès le
-- premier match de la saison, avant que le classement en cours ne soit fiable à lui seul.
alter table public.teams add column prior_ppg numeric;
