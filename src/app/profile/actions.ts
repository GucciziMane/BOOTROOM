"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface UpdateAvatarState {
  error: string | null;
  success: boolean;
}

const MAX_SIZE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function updateAvatar(
  _prevState: UpdateAvatarState,
  formData: FormData
): Promise<UpdateAvatarState> {
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choisis une image.", success: false };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: "Format non supporté (JPEG, PNG, WEBP ou GIF uniquement).", success: false };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { error: "Image trop lourde (3 Mo max).", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  const path = `${user.id}/avatar`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    return { error: `Échec de l'envoi : ${uploadError.message}`, success: false };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: `${publicUrl}?t=${Date.now()}` })
    .eq("id", user.id);

  if (updateError) {
    return { error: `Échec de la mise à jour du profil : ${updateError.message}`, success: false };
  }

  revalidatePath("/profile");
  revalidatePath("/leaderboard");
  revalidatePath("/");
  return { error: null, success: true };
}

export interface SetFavoriteTeamState {
  error: string | null;
  success: boolean;
}

export async function setFavoriteTeam(
  _prevState: SetFavoriteTeamState,
  formData: FormData
): Promise<SetFavoriteTeamState> {
  const raw = formData.get("team_id");
  const teamId = raw ? Number(raw) : null;
  if (raw && (!Number.isInteger(teamId) || (teamId as number) <= 0)) {
    return { error: "Club invalide.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  if (teamId != null) {
    const { data: team } = await supabase.from("teams").select("id, league_id").eq("id", teamId).maybeSingle();
    if (!team) return { error: "Club introuvable.", success: false };
    const { data: league } = await supabase.from("leagues").select("active").eq("id", team.league_id).maybeSingle();
    if (!league?.active) return { error: "Ce championnat n'est pas suivi actuellement.", success: false };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ favorite_team_id: teamId })
    .eq("id", user.id);

  if (updateError) {
    return { error: `Échec de la mise à jour : ${updateError.message}`, success: false };
  }

  revalidatePath("/profile");
  revalidatePath("/");
  return { error: null, success: true };
}

export interface SetThemeModeState {
  error: string | null;
  success: boolean;
}

export async function setThemeMode(
  _prevState: SetThemeModeState,
  formData: FormData
): Promise<SetThemeModeState> {
  const useClubTheme = formData.get("use_club_theme") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non connecté.", success: false };

  if (useClubTheme) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("favorite_team_id")
      .eq("id", user.id)
      .single();
    if (!profile?.favorite_team_id) {
      return { error: "Choisis d'abord un club favori.", success: false };
    }
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ use_club_theme: useClubTheme })
    .eq("id", user.id);

  if (updateError) {
    return { error: `Échec de la mise à jour : ${updateError.message}`, success: false };
  }

  revalidatePath("/", "layout");
  return { error: null, success: true };
}
