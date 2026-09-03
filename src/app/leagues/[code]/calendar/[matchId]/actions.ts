"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SaveMatchPredictionState {
  error: string | null;
  success: boolean;
}

export async function saveMatchPrediction(
  _prevState: SaveMatchPredictionState,
  formData: FormData
): Promise<SaveMatchPredictionState> {
  const matchId = Number(formData.get("match_id"));
  const leagueCode = String(formData.get("league_code"));
  const homeScore = Number(formData.get("predicted_home_score"));
  const awayScore = Number(formData.get("predicted_away_score"));
  const scorerRaw = formData.get("predicted_scorer_player_id");
  const scorerId = scorerRaw && scorerRaw !== "" ? Number(scorerRaw) : null;
  const assistRaw = formData.get("predicted_assist_player_id");
  const assistId = assistRaw && assistRaw !== "" ? Number(assistRaw) : null;

  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    return { error: "Le score doit être un nombre entier positif.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  const { error } = await supabase.from("match_predictions").upsert(
    {
      user_id: user.id,
      match_id: matchId,
      predicted_home_score: homeScore,
      predicted_away_score: awayScore,
      predicted_scorer_player_id: scorerId,
      predicted_assist_player_id: assistId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,match_id" }
  );

  if (error) {
    const locked = error.message.includes("row-level security") || error.code === "42501";
    return {
      error: locked ? "Ce match est verrouillé, pronostic impossible." : `Erreur : ${error.message}`,
      success: false,
    };
  }

  revalidatePath(`/leagues/${leagueCode}/calendar`);
  revalidatePath(`/leagues/${leagueCode}/calendar/${matchId}`);
  revalidatePath("/calendar");
  return { error: null, success: true };
}
