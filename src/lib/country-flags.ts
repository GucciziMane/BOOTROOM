/** Drapeau du pays de chaque championnat, par code football-data.org. */
export const LEAGUE_FLAG: Record<string, string> = {
  FL1: "🇫🇷",
  PL: "🇬🇧",
  PD: "🇪🇸",
  BL1: "🇩🇪",
  PPL: "🇵🇹",
};

/** Couleur d'accent de chaque championnat (bordure des cartes match sur la vue multi-championnats
 * "prochaine journée") : teintes volontairement éloignées les unes des autres pour rester
 * reconnaissables d'un coup d'œil, plutôt que calquées sur les couleurs exactes des drapeaux. */
export const LEAGUE_COLOR: Record<string, string> = {
  FL1: "#2563eb", // Ligue 1 — bleu
  PL: "#dc2626", // Premier League — rouge
  PD: "#f59e0b", // La Liga — ambre
  BL1: "#111827", // Bundesliga — noir/anthracite
  PPL: "#16a34a", // Primeira Liga — vert
};
