import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/app/BackLink";
import { SoccerHeadsGame } from "./SoccerHeadsGame";

export default async function GamePage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) redirect("/login");

  const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").order("username");
  const currentProfile = (profiles ?? []).find((p) => p.id === user.id);
  const otherProfiles = (profiles ?? [])
    .filter((p) => p.id !== user.id)
    .map((p) => ({ id: p.id, username: p.username, avatarUrl: p.avatar_url }));

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Têtes &amp; Ballon ⚽</h1>
        <BackLink href="/" />
      </div>

      <SoccerHeadsGame
        currentUser={{
          id: user.id,
          username: currentProfile?.username ?? "Toi",
          avatarUrl: currentProfile?.avatar_url ?? null,
        }}
        otherProfiles={otherProfiles}
      />
    </main>
  );
}
