const BASE_URL = "https://tenor.googleapis.com/v2";
// Client ID générique documenté par Tenor pour identifier l'intégration côté leurs stats — pas un
// secret, contrairement à TENOR_API_KEY (celle-là reste strictement côté serveur, jamais exposée
// au navigateur, voir /api/tenor/search).
const CLIENT_KEY = "boot_room_chat";

export interface TenorGif {
  id: string;
  /** URL du GIF plein format (CDN Tenor, publique et permanente) — c'est elle qu'on stocke dans
   * chat_messages.gif_url telle quelle, jamais retéléchargée ni re-hébergée. */
  url: string;
  /** Version compressée pour la grille de résultats — le format plein est bien trop lourd pour
   * en afficher 20 à la fois pendant que l'utilisateur tape sa recherche. */
  previewUrl: string;
  width: number;
  height: number;
  description: string;
}

interface TenorMediaFormat {
  url: string;
  dims: [number, number];
}

interface TenorResult {
  id: string;
  content_description: string;
  media_formats: {
    gif?: TenorMediaFormat;
    tinygif?: TenorMediaFormat;
    nanogif?: TenorMediaFormat;
  };
}

function toTenorGif(r: TenorResult): TenorGif | null {
  const full = r.media_formats.gif;
  const preview = r.media_formats.tinygif ?? r.media_formats.nanogif ?? full;
  if (!full || !preview) return null;
  return {
    id: r.id,
    url: full.url,
    previewUrl: preview.url,
    width: full.dims[0],
    height: full.dims[1],
    description: r.content_description,
  };
}

async function tenorFetch(path: string, params: Record<string, string>): Promise<TenorGif[]> {
  const apiKey = process.env.TENOR_API_KEY;
  if (!apiKey) throw new Error("TENOR_API_KEY manquante.");

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("client_key", CLIENT_KEY);
  url.searchParams.set("media_filter", "gif,tinygif,nanogif");
  url.searchParams.set("contentfilter", "medium");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Tenor ${path} a échoué: ${response.status}`);
  const data = (await response.json()) as { results: TenorResult[] };
  return data.results.map(toTenorGif).filter((g): g is TenorGif => g !== null);
}

/** Recherche par mot-clé. */
export async function searchTenorGifs(query: string, limit = 24): Promise<TenorGif[]> {
  return tenorFetch("/search", { q: query, limit: String(limit) });
}

/** GIFs tendance du moment — affichés par défaut avant que l'utilisateur ne tape une recherche. */
export async function getTenorFeatured(limit = 24): Promise<TenorGif[]> {
  return tenorFetch("/featured", { limit: String(limit) });
}

/** Hostnames CDN Tenor légitimes pour un gif_url — jamais faire confiance à une URL fournie par le
 * client sans ce filtre (voir sendChatMessage) : un but/passe... pardon, un chat_messages.gif_url
 * arbitraire pointant ailleurs serait une porte ouverte à héberger n'importe quelle image via
 * notre app. */
export function isTenorMediaUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && /(^|\.)tenor\.com$/.test(hostname);
  } catch {
    return false;
  }
}
