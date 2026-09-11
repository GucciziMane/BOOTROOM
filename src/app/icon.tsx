import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Même photo que le fond du dashboard en mode "trophée" (public/images/dashboard-hero.jpg,
// StadiumBackdrop) — lue en base64 à la requête (pas de fetch réseau, fichier déjà dans le
// build) plutôt qu'un dessin abstrait : l'utilisateur veut littéralement CE stade comme logo.
const heroBase64 = readFileSync(join(process.cwd(), "public/images/dashboard-hero.jpg")).toString("base64");

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative" }}>
        <img
          src={`data:image/jpeg;base64,${heroBase64}`}
          alt=""
          width={size.width}
          height={size.height}
          // object-position biaisé vers le haut : la photo est en portrait (428x626), un recadrage
          // carré centré par défaut coupe les projecteurs (partie la plus reconnaissable, en haut
          // du cadre) au profit de la pelouse en bas.
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 15%" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(11,16,32,0.12) 0%, rgba(11,16,32,0.55) 100%)",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
