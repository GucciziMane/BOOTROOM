"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SaveSeasonPredictionState {
  error: string | null;
  success: boolean;
}

function parseTeamId(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (!raw || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function saveSeasonPrediction(
  _prevState: SaveSeasonPredictionState,
  formData: FormData
): Promise<SaveSeasonPredictionState> {
  const seasonId = Number(formData.get("season_id"));
  const leagueCode = String(formData.get("league_code"));

  const topScorerId = parseTeamId(formData, "top_scorer_player_id");
  const topAssistId = parseTeamId(formData, "top_assist_player_id");
  const surpriseTeamId = parseTeamId(formData, "surprise_team_id");
  const flopTeamId = parseTeamId(formData, "flop_team_id");

  const top3: Record<string, number> = {};
  const bottom3: Record<string, number> = {};
  for (const rank of [1, 2, 3]) {
    const topTeamId = parseTeamId(formData, `top3_${rank}`);
    const bottomTeamId = parseTeamId(formData, `bottom3_${rank}`);
    if (topTeamId) top3[String(rank)] = topTeamId;
    if (bottomTeamId) bottom3[String(rank)] = bottomTeamId;
  }

  if (new Set(Object.values(top3)).size !== Object.values(top3).length) {
    return { error: "Le top 3 doit contenir 3 équipes différentes.", success: false };
  }
  if (new Set(Object.values(bottom3)).size !== Object.values(bottom3).length) {
    return { error: "Le flop 3 doit contenir 3 équipes différentes.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  const { error } = await supabase.from("season_predictions").upsert(
    {
      user_id: user.id,
      season_id: seasonId,
      top_scorer_player_id: topScorerId,
      top_assist_player_id: topAssistId,
      top3,
      bottom3,
      surprise_team_id: surpriseTeamId,
      flop_team_id: flopTeamId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,season_id" }
  );

  if (error) {
    const locked = error.message.includes("row-level security") || error.code === "42501";
    return {
      error: locked
        ? "Les pronostics de saison sont verrouillés pour ce championnat."
        : `Erreur : ${error.message}`,
      success: false,
    };
  }

  revalidatePath(`/leagues/${leagueCode}`);
  return { error: null, success: true };
}
