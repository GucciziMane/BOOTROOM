import type { Metadata } from "next";
import { Comic_Neue } from "next/font/google";
import { BottomNav } from "./BottomNav";
import "./globals.css";

// Comic Sans MS est une police système (non distribuable) : on la place en tête de pile,
// avec Comic Neue (équivalent libre) chargée en secours pour les systèmes qui ne l'ont pas.
const comicNeue = Comic_Neue({
  variable: "--font-comic-neue",
  subsets: ["latin"],
  weight: ["400", "700"],
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${comicNeue.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-24 lg:pb-0">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
