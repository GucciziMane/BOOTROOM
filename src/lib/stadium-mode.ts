/**
 * "Mode trophée" = pas de thème de club actif (pas de club favori choisi, ou thème de club
 * désactivé) — c'est le mode par défaut, avec la photo de stade en fond (StadiumBackdrop, posée
 * globalement dans layout.tsx) et les cartes en verre dépoli sombre plutôt qu'en blanc/papier.
 * Même condition que layout.tsx (getClubTheme) et page.tsx (clubHomeData), réduite au booléen
 * pour les pages qui n'ont besoin que de savoir quel habillage appliquer, pas des couleurs/logo
 * du club.
 */
export function isStadiumMode(profile: { use_club_theme: boolean | null; favorite_team_id: number | null } | null): boolean {
  return !(profile?.use_club_theme && profile?.favorite_team_id);
}
