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
  const isDoubled = formData.get("is_doubled") === "1";

  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    return { error: "Le score doit être un nombre entier positif.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  // x2 : un seul actif à la fois par (utilisateur, championnat, journée) — en activer un nouveau
  // désactive celui déjà posé ailleurs dans la même journée, sauf si cet autre match est déjà
  // verrouillé (la policy RLS bloque alors silencieusement la désactivation, 0 ligne affectée : on
  // le détecte pour refuser proprement plutôt que de se retrouver avec deux x2 actifs à la fois).
  if (isDoubled) {
    const { data: thisMatch } = await supabase.from("matches").select("league_id, matchday").eq("id", matchId).maybeSingle();
    if (thisMatch?.matchday != null) {
      const { data: siblingMatches } = await supabase
        .from("matches")
        .select("id")
        .eq("league_id", thisMatch.league_id)
        .eq("matchday", thisMatch.matchday)
        .neq("id", matchId);
      const siblingIds = (siblingMatches ?? []).map((m) => m.id);
      if (siblingIds.length > 0) {
        const { data: existingDoubled } = await supabase
          .from("match_predictions")
          .select("match_id")
          .eq("user_id", user.id)
          .in("match_id", siblingIds)
          .eq("is_doubled", true)
          .maybeSingle();
        if (existingDoubled) {
          const { data: unset } = await supabase
            .from("match_predictions")
            .update({ is_doubled: false })
            .eq("user_id", user.id)
            .eq("match_id", existingDoubled.match_id)
            .select("match_id");
          if (!unset || unset.length === 0) {
            return {
              error: "Ton x2 de cette journée est déjà posé sur un autre match déjà verrouillé.",
              success: false,
            };
          }
        }
      }
    }
  }

  const { error } = await supabase.from("match_predictions").upsert(
    {
      user_id: user.id,
      match_id: matchId,
      predicted_home_score: homeScore,
      predicted_away_score: awayScore,
      predicted_scorer_player_id: scorerId,
      predicted_assist_player_id: assistId,
      is_doubled: isDoubled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,match_id" }
  );

  if (error) {
    const locked = error.message.includes("row-level security") || error.code === "42501";
    // 23505 sur match_predictions_one_double_per_matchday (voir migration 0042) : deux requêtes
    // concurrentes ont chacune passé le contrôle "pas de x2 déjà actif" ci-dessus avant que l'une
    // des deux ne committe — la contrainte a bloqué le second upsert. Cas rare, message dédié
    // plutôt que le message Postgres brut.
    const doubleConflict = error.code === "23505" && error.message.includes("match_predictions_one_double_per_matchday");
    return {
      error: locked
        ? "Ce match est verrouillé, pronostic impossible."
        : doubleConflict
          ? "Un x2 a été activé sur un autre match entre-temps, réessaie."
          : `Erreur : ${error.message}`,
      success: false,
    };
  }

  revalidatePath(`/leagues/${leagueCode}/calendar`);
  revalidatePath(`/leagues/${leagueCode}/calendar/${matchId}`);
  revalidatePath("/calendar");
  return { error: null, success: true };
}

/** Cloche "but" d'un match : muette par défaut, chacun l'active indépendamment pour ce match
 * précis (voir live-tick, qui ne notifie plus que les abonnés d'un match donné). Pas de
 * revalidatePath : ce réglage n'affecte que ce qu'affiche cet utilisateur-ci sur cette carte. */
export async function toggleGoalSubscription(matchId: number, subscribe: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  const { error } = subscribe
    ? await supabase.from("match_goal_subscriptions").upsert(
        { user_id: user.id, match_id: matchId },
        { onConflict: "user_id,match_id" }
      )
    : await supabase.from("match_goal_subscriptions").delete().eq("user_id", user.id).eq("match_id", matchId);

  return { error: error ? `Erreur : ${error.message}` : null };
}
