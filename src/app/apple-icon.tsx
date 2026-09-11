import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Même dessin que icon.tsx, à l'échelle de l'icône iOS (180x180) — voir ce fichier pour le
// raisonnement.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #131a30 0%, #0b1020 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "78%",
            height: "78%",
            borderRadius: "9999px",
            background:
              "radial-gradient(circle, rgba(255,247,224,1) 0%, rgba(217,154,24,0.85) 32%, rgba(217,154,24,0) 68%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-38%",
            width: "150%",
            height: "70%",
            borderRadius: "9999px",
            background: "#0b1020",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
