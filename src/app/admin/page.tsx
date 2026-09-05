import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { BackLink } from "@/app/BackLink";
import { DeleteUserButton } from "./DeleteUserButton";
import { RefreshScoresButton } from "./RefreshScoresButton";

// Le refresh peut prendre du temps (events buteurs API-Football + calcul des points) :
// on aligne la limite sur le budget max des fonctions Vercel plutôt que le défaut des Server Actions.
export const maxDuration = 300;

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
        <BackLink href="/" />
      </div>

      <h2 className="mb-3 text-lg font-bold">Scores &amp; points</h2>
      <p className="mb-3 text-sm text-mute">
        Les matchs et les points se rafraîchissent automatiquement toutes les 2h. En cas de retard, force
        l&apos;actualisation ici.
      </p>
      <div className="mb-8">
        <RefreshScoresButton />
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
