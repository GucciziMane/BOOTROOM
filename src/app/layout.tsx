import type { Metadata } from "next";
import { ThemeApplier } from "./ThemeApplier";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://bootroom.app"),
  title: { default: "Bootroom", template: "%s | Bootroom" },
  description: "L'application ultime pour les fans de football - Quiz, Chat, Leaderboard",
  keywords: ["football", "quiz", "chat", "leaderboard", "ligues", "calendrier"],
  authors: [{ name: "Bootroom Team" }],
  creator: "Bootroom",
  publisher: "Bootroom",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-video-preview": -1, "max-image-preview": "large", "max-snippet": -1 } },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Bootroom" },
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: { type: "website", locale: "fr_FR", url: "https://bootroom.app", siteName: "Bootroom", title: "Bootroom", description: "L'application ultime pour les fans de football", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Bootroom" }] },
  twitter: { card: "summary_large_image", title: "Bootroom", description: "L'application ultime pour les fans de football", images: ["/og-image.png"] },
  icons: { icon: "/favicon.ico", shortcut: "/favicon-16x16.png", apple: "/apple-touch-icon.png" },
};

export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
          </>
        )}
      </head>
      <body className="antialiased min-h-screen bg-background font-sans">
        <ThemeApplier />
        {children}
      </body>
    </html>
  );
}
