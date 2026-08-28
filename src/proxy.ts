import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // /api/cron/* gère sa propre authentification (CRON_SECRET), pas la session utilisateur.
  // manifest.webmanifest/icon/apple-icon/sw.js doivent rester accessibles sans session : Safari
  // les récupère pour "Sur l'écran d'accueil" avant même que l'utilisateur soit connecté.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|sw.js|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
