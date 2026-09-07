/** Image de fond des cartes de pronostic, par code football-data.org — voir MatchPredictionCard.
 * Fournies par l'utilisateur (logos/visuels officiels de chaque championnat), pas générées.
 * `light: true` pour un fond clair/blanc (le dégradé sombre standard écraserait ses couleurs à
 * plat) : la carte y bascule sur un léger voile clair et du texte sombre plutôt que blanc. */
export interface LeagueBackground {
  image: string;
  light?: boolean;
}

export const LEAGUE_BACKGROUND: Record<string, LeagueBackground> = {
  CL: { image: "/champions-league-stadium.jpg" },
  PL: { image: "/league-bg-pl.jpg" },
  FL1: { image: "/league-bg-fl1.webp" },
  PD: { image: "/league-bg-pd.jpg", light: true },
  BL1: { image: "/league-bg-bl1.webp" },
  PPL: { image: "/league-bg-ppl.jpg" },
};
