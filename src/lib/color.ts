const FALLBACK_COLOR = "#4f46e5";

function normalizeHex(value: string): string {
  const hex = value.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }

  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split("")
      .map((character) => character + character)
      .join("")
      .toLowerCase()}`;
  }

  return FALLBACK_COLOR;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex);

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/**
 * Assombrit une couleur claire afin que du texte blanc reste lisible
 * lorsqu’elle est utilisée comme fond de bouton.
 */
export function ensureReadableOnLight(hex: string): string {
  const [red, green, blue] = hexToRgb(hex);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  if (luminance <= 0.7) {
    return rgbToHex(red, green, blue);
  }

  return rgbToHex(red * 0.6, green * 0.6, blue * 0.6);
}

/**
 * Assombrit une couleur tout en garantissant une valeur de facteur sûre.
 * `0` correspond au noir, `1` conserve la couleur originale.
 */
export function darken(hex: string, factor: number): string {
  const [red, green, blue] = hexToRgb(hex);
  const safeFactor = Math.max(0, Math.min(1, factor));

  return rgbToHex(red * safeFactor, green * safeFactor, blue * safeFactor);
}

/**
 * Éclaircit une couleur en la mélangeant avec du blanc.
 * `0` conserve la couleur originale et `1` produit du blanc.
 */
export function mixWithWhite(hex: string, whiteRatio: number): string {
  const [red, green, blue] = hexToRgb(hex);
  const ratio = Math.max(0, Math.min(1, whiteRatio));
  const mix = (channel: number) => channel * (1 - ratio) + 255 * ratio;

  return rgbToHex(mix(red), mix(green), mix(blue));
}
