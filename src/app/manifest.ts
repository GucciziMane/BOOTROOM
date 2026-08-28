import type { MetadataRoute } from "next";

// Sans manifest, l'icône "Sur l'écran d'accueil" iOS n'est qu'un signet plein écran : Safari ne
// la reconnaît pas comme une app installée et peut purger ses cookies/stockage à la fermeture,
// déconnectant l'utilisateur. Avec un manifest + display "standalone", iOS lui garantit une
// persistance de stockage proche d'une vraie app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Boot Room",
    short_name: "Boot Room",
    description: "Pronostics entre amis sur les 5 grands championnats",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f1e6",
    theme_color: "#211c14",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
