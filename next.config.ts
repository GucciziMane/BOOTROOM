import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js limite le corps des Server Actions à 1 Mo par défaut : trop petit pour une
    // vraie photo (profil ou chat) envoyée depuis un téléphone.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  images: {
    // Vercel ne facture les Image Optimization Transformations qu'une fois par image source,
    // mais recompte dès que le cache d'une variante expire (défaut Next.js : 60s). Nos images
    // (blasons, photos joueurs, avatars versionnés par ?t=) sont statiques ou déjà cache-bustées,
    // donc un TTL long élimine les recalculs inutiles sans jamais servir une image périmée.
    minimumCacheTTL: 31536000,
    remotePatterns: [
      // Photos de profil stockées dans Supabase Storage (bucket public) : on laisse next/image
      // les redimensionner/compresser à la volée plutôt que de servir le fichier original.
      { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" },
      // Photos de chat (bucket privé, cf. migration 0030) : jamais d'URL publique, uniquement des
      // URL signées à la demande (/object/sign/**, chemin distinct de /object/public/** ci-dessus).
      { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/sign/**" },
      // Blasons des clubs (football-data.org) : idem, affichés des dizaines de fois par page.
      { protocol: "https", hostname: "crests.football-data.org" },
      // Photos de joueurs, résolues depuis l'image d'infobox Wikipédia de chaque joueur
      // (scripts/fetch-wikipedia-squads.mjs) — servies par Wikimedia, pas par Wikipédia lui-même.
      { protocol: "https", hostname: "upload.wikimedia.org" },
    ],
  },
};

export default nextConfig;
