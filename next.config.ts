import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js limite le corps des Server Actions à 1 Mo par défaut : trop petit pour une
    // vraie photo de profil envoyée depuis un téléphone.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
