const BASE_URL = "https://api.giphy.com/v1/gifs";

export interface GiphyGif {
  id: string;
  /** URL du GIF plein format (CDN Giphy, publique et permanente) — c'est elle qu'on stocke dans
   * chat_messages.gif_url telle quelle, jamais retéléchargée ni re-hébergée. */
  url: string;
  /** Version compressée pour la grille de résultats — le format plein est bien trop lourd pour
   * en afficher 20 à la fois pendant que l'utilisateur tape sa recherche. */
  previewUrl: string;
  width: number;
  height: number;
  description: string;
}

interface GiphyImageVariant {
  url: string;
  width: string;
  height: string;
}

interface GiphyResult {
  id: string;
  title: string;
  images: {
    original: GiphyImageVariant;
    fixed_width_small?: GiphyImageVariant;
    preview_gif?: GiphyImageVariant;
  };
}

function toGiphyGif(r: GiphyResult): GiphyGif | null {
  const full = r.images.original;
  const preview = r.images.fixed_width_small ?? r.images.preview_gif ?? full;
  if (!full || !preview) return null;
  return {
    id: r.id,
    url: full.url,
    previewUrl: preview.url,
    width: Number(full.width),
    height: Number(full.height),
    description: r.title,
  };
}

async function giphyFetch(path: string, params: Record<string, string>): Promise<GiphyGif[]> {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) throw new Error("GIPHY_API_KEY manquante.");

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("rating", "pg-13");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Giphy ${path} a échoué: ${response.status}`);
  const data = (await response.json()) as { data: GiphyResult[] };
  return data.data.map(toGiphyGif).filter((g): g is GiphyGif => g !== null);
}

/** Recherche par mot-clé. */
export async function searchGiphyGifs(query: string, limit = 24): Promise<GiphyGif[]> {
  return giphyFetch("/search", { q: query, limit: String(limit) });
}

/** GIFs tendance du moment — affichés par défaut avant que l'utilisateur ne tape une recherche. */
export async function getGiphyTrending(limit = 24): Promise<GiphyGif[]> {
  return giphyFetch("/trending", { limit: String(limit) });
}

/** Hostnames CDN Giphy légitimes pour un gif_url — jamais faire confiance à une URL fournie par le
 * client sans ce filtre (voir sendChatMessage) : un chat_messages.gif_url arbitraire pointant
 * ailleurs serait une porte ouverte à héberger n'importe quelle image via notre app. */
export function isGiphyMediaUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && /(^|\.)giphy\.com$/.test(hostname);
  } catch {
    return false;
  }
}
