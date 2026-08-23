import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { card, linkMuted } from "@/lib/ui";
import { AvatarForm } from "./AvatarForm";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", user!.id)
    .single();

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
        <AvatarForm username={profile?.username ?? "?"} avatarUrl={profile?.avatar_url ?? null} />
      </div>
    </main>
  );
}
