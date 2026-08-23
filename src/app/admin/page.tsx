import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { linkMuted, listCard } from "@/lib/ui";
import { DeleteUserButton } from "./DeleteUserButton";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: callerProfile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!callerProfile?.is_admin) notFound();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, is_admin")
    .order("username");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Administration</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <h2 className="mb-3 text-lg font-bold">Membres</h2>
      <ul className={listCard}>
        {(profiles ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between p-4">
            <span className="font-bold">
              {p.username} {p.is_admin && <span className="text-sm font-normal text-mute">(admin)</span>}
            </span>
            {p.id !== user.id && <DeleteUserButton userId={p.id} username={p.username} />}
          </li>
        ))}
      </ul>
    </main>
  );
}
