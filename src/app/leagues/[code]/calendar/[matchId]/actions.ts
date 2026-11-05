"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SaveMatchPredictionState {
  error: string | null;
  success: boolean;
  /** Pronostic bien enregistré, mais sans le x2 demandé (impossible à poser sur ce match) — le
   * pronostic lui-même ne doit jamais être perdu à cause du x2. */
  notice?: string | null;
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
  const isDoubledField = formData.get("is_doubled");

  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    return { error: "Le score doit être un nombre entier positif.", success: false };
  }

  // 0-0 : aucun but marqué, donc aucun buteur ni passeur possible — revalidé ici indépendamment
  // du client (les deux formulaires désactivent déjà les sélecteurs dans ce cas, mais rien
  // n'empêche un appel direct de cette action avec des champs encore renseignés).
  if (homeScore === 0 && awayScore === 0 && (scorerId != null || assistId != null)) {
    return { error: "Score 0-0 : impossible de choisir un buteur ou un passeur.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  // Certains formulaires (page détail d'un match) ne gèrent pas le x2 et n'envoient jamais ce
  // champ : dans ce cas, préserve la valeur déjà enregistrée en base plutôt que de la réinitialiser
  // à false par défaut — sans ça, une sauvegarde depuis cette page désactivait silencieusement un
  // x2 déjà activé via MatchPredictionCard (seul endroit qui expose réellement l'activation/
  // désactivation du x2). Relu en base à chaque fois, jamais fait confiance à une valeur transmise
  // par le client : le serveur reste la seule source de vérité pour ce cas.
  let isDoubled: boolean;
  if (isDoubledField === null) {
    const { data: currentPrediction } = await supabase
      .from("match_predictions")
      .select("is_doubled")
      .eq("user_id", user.id)
      .eq("match_id", matchId)
      .maybeSingle();
    isDoubled = currentPrediction?.is_doubled ?? false;
  } else {
    isDoubled = isDoubledField === "1";
  }

  // x2 : un seul actif à la fois par (utilisateur, championnat, journée) — en activer un nouveau
  // désactive celui déjà posé ailleurs dans la même journée, sauf si cet autre match est déjà
  // verrouillé (la policy RLS bloque alors silencieusement la désactivation, 0 ligne affectée).
  // Quand le x2 demandé est impossible, le pronostic est enregistré quand même, SANS x2, et
  // `doubleDropped` explique pourquoi : refuser tout le pronostic faisait perdre score/buteur/
  // passeur sans que le joueur s'en rende forcément compte (cas réel : un prono jamais enregistré).
  let doubleDropped: string | null = null;
  if (isDoubled) {
    const { data: thisMatch } = await supabase.from("matches").select("league_id, matchday").eq("id", matchId).maybeSingle();
    // matchday NULL (match introuvable, ou stage hors des tours à élimination directe connus de
    // sync-fixtures, cf. KNOCKOUT_STAGE_ORDER) : le contrôle d'unicité ci-dessous ne peut pas
    // s'appliquer (NULL n'est jamais égal à un autre NULL pour l'index unique
    // match_predictions_one_double_per_matchday), donc plusieurs x2 pourraient coexister sans
    // qu'aucune vérification ne les détecte — x2 abandonné plutôt que de sauter le contrôle.
    if (thisMatch?.matchday == null) {
      doubleDropped = "Pronostic enregistré, mais sans x2 : journée de ce match pas encore déterminée.";
      isDoubled = false;
    } else {
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
            doubleDropped = "Pronostic enregistré, mais sans x2 : ton x2 de cette journée est déjà sur un match commencé.";
            isDoubled = false;
          }
        }
      }
    }
  }

  const upsertPrediction = (doubled: boolean) =>
    supabase.from("match_predictions").upsert(
      {
        user_id: user.id,
        match_id: matchId,
        predicted_home_score: homeScore,
        predicted_away_score: awayScore,
        predicted_scorer_player_id: scorerId,
        predicted_assist_player_id: assistId,
        is_doubled: doubled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,match_id" }
    );
  let { error } = await upsertPrediction(isDoubled);

  // 23505 sur match_predictions_one_double_per_matchday (voir migration 0042) : deux requêtes
  // concurrentes ont chacune passé le contrôle "pas de x2 déjà actif" ci-dessus avant que l'une
  // des deux ne committe — la contrainte a bloqué cet upsert. Même règle que plus haut : on garde
  // le pronostic, sans le x2.
  if (error && isDoubled && error.code === "23505" && error.message.includes("match_predictions_one_double_per_matchday")) {
    doubleDropped = "Pronostic enregistré, mais sans x2 : un x2 a été activé sur un autre match entre-temps.";
    ({ error } = await upsertPrediction(false));
  }

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
  return { error: null, success: true, notice: doubleDropped };
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
