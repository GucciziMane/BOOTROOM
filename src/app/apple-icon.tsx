import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Même dessin que icon.tsx, à l'échelle de l'icône iOS (180x180) — voir ce fichier pour le
// raisonnement.
const heroBase64 = readFileSync(join(process.cwd(), "public/images/dashboard-hero.jpg")).toString("base64");

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative" }}>
        <img
          src={`data:image/jpeg;base64,${heroBase64}`}
          alt=""
          width={size.width}
          height={size.height}
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
