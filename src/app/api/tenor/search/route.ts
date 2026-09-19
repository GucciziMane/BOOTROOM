import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchTenorGifs, getTenorFeatured } from "@/lib/tenor/client";

// Simple proxy vers Tenor : TENOR_API_KEY ne doit jamais atteindre le navigateur, donc toute
// recherche passe par ce endpoint plutôt que d'appeler Tenor directement depuis ChatRoom.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  try {
    const gifs = q ? await searchTenorGifs(q) : await getTenorFeatured();
    return NextResponse.json({ gifs });
  } catch {
    // Clé manquante/invalide ou Tenor indisponible : on ne casse jamais le chat pour ça, juste
    // une liste vide — le picker affichera "aucun résultat" plutôt qu'une page d'erreur.
    return NextResponse.json({ gifs: [] });
  }
}
