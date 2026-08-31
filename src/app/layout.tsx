import type { Metadata } from "next";
import { Suspense } from "react";
import { Instrument_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "./BottomNav";
import { ThemeApplier, ClubCrestWatermark } from "./ThemeApplier";
import "./globals.css";

const comicNeue = Instrument_Sans({
  variable: "--font-comic-neue",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Boot Room",
  description: "Pronostics entre amis sur les 5 grands championnats",
  appleWebApp: {
    capable: true,
    title: "Boot Room",
    statusBarStyle: "black-translucent",
  },
};

interface ClubTheme {
  enabled: boolean;
  primaryColor: string | null;
  secondaryColor: string | null;
  crestUrl: string | null;
}

async function getClubTheme(): Promise<ClubTheme> {
  const empty: ClubTheme = { enabled: false, primaryColor: null, secondaryColor: null, crestUrl: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return empty;

  const { data: profile } = await supabase
    .from("profiles")
    .select("use_club_theme, favorite_team_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.use_club_theme || !profile.favorite_team_id) return empty;

  const { data: team } = await supabase
    .from("teams")
    .select("primary_color, secondary_color, logo_url")
    .eq("id", profile.favorite_team_id)
    .maybeSingle();

  if (!team?.primary_color) return empty;

  return {
    enabled: true,
    primaryColor: team.primary_color,
    secondaryColor: team.secondary_color,
    crestUrl: team.logo_url,
  };
}

// Composant à part, chargé sous Suspense : le thème de club demande 2-3 allers-retours Supabase
// séquentiels (auth puis profil puis équipe). Avant, ce await était directement dans RootLayout et
// bloquait l'affichage de TOUTE la coquille (y compris {children}) derrière ces requêtes sur
// chaque navigation — un gros contributeur au temps de chargement perçu au lancement de la PWA.
// Isolé ici, le reste de la page peut s'afficher immédiatement pendant que ça résout.
async function ClubThemeLayer() {
  const clubTheme = await getClubTheme();
  return (
    <>
      <ClubCrestWatermark enabled={clubTheme.enabled} crestUrl={clubTheme.crestUrl} />
      <ThemeApplier
        enabled={clubTheme.enabled}
        primaryColor={clubTheme.primaryColor}
        secondaryColor={clubTheme.secondaryColor}
      />
    </>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${comicNeue.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-32 lg:pb-0">
        <Suspense fallback={null}>
          <ClubThemeLayer />
        </Suspense>
        {/* position:relative pour peindre au-dessus du filigrane (voir ThemeApplier.tsx) : un
            z-index négatif sur un élément fixed s'est révélé invisible dans certains moteurs de
            rendu (recouvert par le fond du body), donc le filigrane utilise z-0 et c'est ce
            wrapper, plus tardif dans le DOM et lui aussi "positionné", qui passe par-dessus. */}
        <div className="relative z-10 flex flex-1 flex-col">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
