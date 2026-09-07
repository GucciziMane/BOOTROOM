import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveMatches } from "@/lib/live-matches";

export async function GET() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici — route interrogée en polling
  // pour le bandeau "en direct", chaque ms compte plus qu'ailleurs.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const matches = await getLiveMatches(supabase);
  return NextResponse.json({ matches });
}
