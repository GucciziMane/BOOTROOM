/** Image de fond des cartes de pronostic, par code football-data.org — voir MatchPredictionCard.
 * Fournies par l'utilisateur (logos/visuels officiels de chaque championnat), pas générées.
 * `light: true` pour un fond clair/blanc (le dégradé sombre standard écraserait ses couleurs à
 * plat) : la carte y bascule sur un léger voile clair et du texte sombre plutôt que blanc.
 * `button`/`buttonHover` : couleur du bouton "Enregistrer" assortie à l'image (demandé
 * explicitement) — absent pour une compétition qui garde le violet par défaut de l'appli. */
export interface LeagueBackground {
  image: string;
  light?: boolean;
  button?: string;
  buttonHover?: string;
}

export const LEAGUE_BACKGROUND: Record<string, LeagueBackground> = {
  CL: { image: "/champions-league-stadium.jpg" },
  PL: { image: "/league-bg-pl.jpg", button: "#6d28d9", buttonHover: "#5b21b6" },
  FL1: { image: "/league-bg-fl1.jpg", button: "#3b82f6", buttonHover: "#2563eb" },
  PD: { image: "/league-bg-pd.jpg", light: true, button: "#e2231a", buttonHover: "#b81b14" },
  BL1: { image: "/league-bg-bl1.webp" },
  PPL: { image: "/league-bg-ppl.jpg" },
};
