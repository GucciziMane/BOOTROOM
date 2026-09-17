"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export interface SaveBallonDorResult {
  error: string | null;
  success?: boolean;
}

// Une seule édition suivie pour l'instant (voir ballon_dor_editions) — pas encore de sélecteur
// d'année côté UI, donc pas besoin de la faire remonter depuis le client.
const EDITION_YEAR = 2026;

export async function saveBallonDorPrediction(picks: Record<string, number>): Promise<SaveBallonDorResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté." };

  const admin = createServiceRoleClient();

  const { data: edition } = await admin
    .from("ballon_dor_editions")
    .select("predictions_lock_at")
    .eq("year", EDITION_YEAR)
    .maybeSingle();
  if (!edition) return { error: "Édition introuvable." };
  // Revérifié ici même si RLS l'impose déjà côté écriture (defense in depth, comme le reste de
  // l'appli) — un message clair plutôt qu'une erreur Postgres brute si jamais quelqu'un soumet
  // juste après le verrouillage.
  if (Date.now() >= new Date(edition.predictions_lock_at).getTime()) {
    return { error: "Les pronostics sont verrouillés." };
  }

  // Ce chemin passe par le service role (bypass RLS, voir plus bas) : la policy "insert-only"
  // (migration 0061) ne protège donc pas ici contre une seconde validation — revérifié
  // explicitement, une fois pour toutes, avant d'écrire quoi que ce soit.
  const { data: existing } = await admin
    .from("ballon_dor_predictions")
    .select("id")
    .eq("user_id", user.id)
    .eq("edition_year", EDITION_YEAR)
    .maybeSingle();
  if (existing) return { error: "Ton pronostic est déjà validé, il ne peut plus être modifié." };

  const entries = Object.entries(picks);
  if (entries.length === 0) return { error: "Aucun joueur placé." };
  for (const [rank] of entries) {
    const r = Number(rank);
    if (!Number.isInteger(r) || r < 1 || r > 10) return { error: "Place invalide." };
  }
  // Jamais faire confiance au client pour l'absence de doublon — revérifié ici avant écriture.
  const nomineeIds = Object.values(picks);
  if (new Set(nomineeIds).size !== nomineeIds.length) {
    return { error: "Un joueur ne peut être placé qu'à une seule place." };
  }

  const { data: validNominees } = await admin
    .from("ballon_dor_nominees")
    .select("id")
    .eq("edition_year", EDITION_YEAR)
    .in("id", nomineeIds);
  if ((validNominees?.length ?? 0) !== nomineeIds.length) {
    return { error: "Joueur invalide pour cette édition." };
  }

  // insert (pas upsert) : il n'existe plus aucun chemin légitime de mise à jour une fois validé
  // (voir la vérification "existing" ci-dessus) — la contrainte unique (user_id, edition_year)
  // reste un filet en cas de double soumission concurrente.
  const { error } = await admin
    .from("ballon_dor_predictions")
    .insert({ user_id: user.id, edition_year: EDITION_YEAR, picks, updated_at: new Date().toISOString() });
  if (error) {
    if (error.code === "23505") return { error: "Ton pronostic est déjà validé, il ne peut plus être modifié." };
    return { error: error.message };
  }

  revalidatePath("/ballon-dor");
  return { error: null, success: true };
}
