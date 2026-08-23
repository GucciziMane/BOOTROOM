import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js limite le corps des Server Actions à 1 Mo par défaut : trop petit pour une
    // vraie photo de profil envoyée depuis un téléphone.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  images: {
    // Photos de profil stockées dans Supabase Storage : on laisse next/image les
    // redimensionner/compresser à la volée plutôt que de servir le fichier original.
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;
