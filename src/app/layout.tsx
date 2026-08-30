import type { Metadata } from "next";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const clubTheme = await getClubTheme();

  return (
    <html lang="fr" className={`${comicNeue.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-32 lg:pb-0">
        <ClubCrestWatermark enabled={clubTheme.enabled} crestUrl={clubTheme.crestUrl} />
        {children}
        <BottomNav />
        <ThemeApplier
          enabled={clubTheme.enabled}
          primaryColor={clubTheme.primaryColor}
          secondaryColor={clubTheme.secondaryColor}
        />
      </body>
    </html>
  );
}
