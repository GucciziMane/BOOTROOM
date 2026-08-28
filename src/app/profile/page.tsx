import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getFavoriteTeamLeagueGroups } from "@/lib/favorite-teams";
import { card, linkMuted } from "@/lib/ui";
import { AvatarForm } from "./AvatarForm";
import { ProfileFavoriteTeam } from "./ProfileFavoriteTeam";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url, favorite_team_id")
    .eq("id", user!.id)
    .single();

  const leagues = await getFavoriteTeamLeagueGroups(supabase);
  const favoriteTeam = leagues.flatMap((l) => l.teams).find((t) => t.id === profile?.favorite_team_id) ?? null;

  return (
    <main className="mx-auto w-full max-w-md flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Mon profil</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <div className={card}>
        <p className="mb-6 text-center text-lg font-bold">{profile?.username}</p>
        <AvatarForm
          username={profile?.username ?? "?"}
          avatarUrl={profile?.avatar_url ?? null}
          favoriteTeamLogoUrl={favoriteTeam?.logoUrl ?? null}
        />
      </div>

      <div className={`mt-4 ${card}`}>
        <h2 className="mb-1 font-bold">Club favori</h2>
        <p className="mb-4 text-sm text-mute">
          Affiché en petit sur ton avatar. {favoriteTeam ? `Actuellement : ${favoriteTeam.name}.` : "Aucun club choisi."}
        </p>
        <ProfileFavoriteTeam leagues={leagues} initialTeamId={profile?.favorite_team_id ?? null} />
      </div>
    </main>
  );
}
