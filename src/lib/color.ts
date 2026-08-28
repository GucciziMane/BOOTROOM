/** Assombrit une couleur claire pour garder du texte blanc lisible dessus (boutons pleins). */
export function ensureReadableOnLight(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance <= 0.7) return hex;
  const factor = 0.6;
  return rgbToHex(Math.round(r * factor), Math.round(g * factor), Math.round(b * factor));
}

export function darken(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHex(Math.round(r * factor), Math.round(g * factor), Math.round(b * factor));
}

/** Éclaircit une couleur en la mélangeant avec du blanc (ex : 0.9 = 90% blanc, 10% couleur). */
export function mixWithWhite(hex: string, whiteRatio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => c * (1 - whiteRatio) + 255 * whiteRatio;
  return rgbToHex(Math.round(mix(r)), Math.round(mix(g)), Math.round(mix(b)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`;
}
