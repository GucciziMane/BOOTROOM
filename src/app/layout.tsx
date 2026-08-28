import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "./BottomNav";
import { ThemeApplier } from "./ThemeApplier";
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

async function getClubTheme(): Promise<{ enabled: boolean; primaryColor: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { enabled: false, primaryColor: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("use_club_theme, favorite_team_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.use_club_theme || !profile.favorite_team_id) return { enabled: false, primaryColor: null };

  const { data: team } = await supabase
    .from("teams")
    .select("primary_color")
    .eq("id", profile.favorite_team_id)
    .maybeSingle();

  return { enabled: true, primaryColor: team?.primary_color ?? null };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const clubTheme = await getClubTheme();

  return (
    <html lang="fr" className={`${comicNeue.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-32 lg:pb-0">
        {children}
        <BottomNav />
        <ThemeApplier enabled={clubTheme.enabled} primaryColor={clubTheme.primaryColor} />
      </body>
    </html>
  );
}
