import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** Vérifie l'en-tête Authorization: Bearer <CRON_SECRET> ; renvoie une 401 sinon. */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!expected || !provided || !safeCompare(provided, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/** Comparaison à temps constant : une comparaison de chaînes standard s'arrête au premier
 * caractère différent, ce qui fuit en théorie la longueur du préfixe correct via le timing. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual exige des buffers de même longueur : sans ça, une longueur différente jette
  // au lieu de renvoyer false, et comparer sa propre longueur à elle-même ne fuit rien d'utile
  // (la longueur du secret n'est pas une information sensible ici).
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
