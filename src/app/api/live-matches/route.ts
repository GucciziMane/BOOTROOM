import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveMatches } from "@/lib/live-matches";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const matches = await getLiveMatches(supabase);
  return NextResponse.json({ matches });
}
