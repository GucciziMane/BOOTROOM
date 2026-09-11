import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Projecteurs de stade la nuit : même identité que le fond du dashboard en mode "trophée"
// (StadiumBackdrop) — halo chaud (--color-reward) sur fond marine sombre, coupé par une ellipse
// pour suggérer l'horizon d'un stade plutôt qu'un simple cercle abstrait.
export default function Icon() {
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
