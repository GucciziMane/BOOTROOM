import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { BottomNav } from "./BottomNav";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${comicNeue.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-32 lg:pb-0">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
