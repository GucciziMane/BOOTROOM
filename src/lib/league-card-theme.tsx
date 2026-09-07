import Image from "next/image";
import { LEAGUE_BACKGROUND } from "@/lib/league-background";

/** "dark"/"light" : le championnat a une image de fond (voir LEAGUE_BACKGROUND), avec le voile
 * assorti à sa luminosité. "none" : carte par défaut (fond blanc, bordure de couleur). */
export type CardTheme = "none" | "dark" | "light";

export interface LeagueCardStyle {
  theme: CardTheme;
  backgroundImage?: string;
  /** Classes à poser sur le conteneur de la carte (avant d'y ajouter ses propres marges/tailles). */
  cardClassName: string;
  cardStyle?: { borderLeftColor: string; borderLeftWidth: number };
  /** Texte secondaire (dates, libellés) — mute en clair, blanc/70 en sombre. */
  textFaint: string;
  /** Texte principal (score, noms d'équipe) — ink en clair, blanc en sombre, hérité sinon. */
  textStrong: string;
}

/** Habillage d'une carte match par championnat — partagé entre les cartes de pronostic, l'historique
 * "Mes pronos" et le bandeau "En direct", pour qu'une carte se ressemble partout dans l'appli.
 * `padding` : classe Tailwind de padding (p-3/p-4...), le bandeau "En direct" utilisant des cartes
 * plus compactes que les cartes de pronostic pleine largeur. */
export function getLeagueCardStyle(leagueCode: string, leagueColor?: string, padding = "p-4"): LeagueCardStyle {
  const background = LEAGUE_BACKGROUND[leagueCode];
  const theme: CardTheme = background ? (background.light ? "light" : "dark") : "none";

  return {
    theme,
    backgroundImage: background?.image,
    cardClassName:
      theme === "none"
        ? `rounded-2xl border border-line bg-paper shadow-sm ${padding}`
        : `relative overflow-hidden rounded-2xl shadow-md ${padding}`,
    cardStyle: theme === "none" && leagueColor ? { borderLeftColor: leagueColor, borderLeftWidth: 4 } : undefined,
    textFaint: theme === "light" ? "text-mute" : theme === "dark" ? "text-white/70" : "text-mute",
    textStrong: theme === "light" ? "text-ink" : theme === "dark" ? "text-white" : "",
  };
}

/** Couleur du nom d'équipe / des pastilles vides sous le logo, alignée sur le thème de la carte. */
export function leagueCardTeamTextClass(theme: CardTheme): string {
  return theme === "dark" ? "text-white" : theme === "light" ? "text-ink" : "";
}
export function leagueCardTeamPlaceholderClass(theme: CardTheme): string {
  return theme === "dark" ? "bg-white/20" : "bg-cream";
}

export function LeagueCardBackground({ image, light }: { image: string; light: boolean }) {
  return (
    <>
      <Image src={image} alt="" fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" />
      {light ? (
        // Fond déjà clair : un voile blanc translucide suffit à isoler le texte sombre du motif,
        // pas besoin d'assombrir (qui écraserait ses couleurs au lieu de les préserver).
        <div className="absolute inset-0 bg-gradient-to-b from-white/55 via-white/40 to-white/65" />
      ) : (
        // Overlay neutre (noir) plutôt qu'une teinte fixe : chaque championnat garde sa propre
        // couleur de marque en dessous plutôt que de virer vers une teinte imposée.
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/55 to-black/80" />
      )}
    </>
  );
}
