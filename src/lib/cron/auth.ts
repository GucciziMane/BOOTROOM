import { NextRequest, NextResponse } from "next/server";

/** Vérifie l'en-tête Authorization: Bearer <CRON_SECRET> ; renvoie une 401 sinon. */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
