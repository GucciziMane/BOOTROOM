import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { linkMuted, listCard } from "@/lib/ui";

export default async function StandingsLeaguesPage() {
  const supabase = await createClient();

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, country, football_data_code, logo_url")
    .eq("active", true)
    .order("name");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Classements</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <p className="mb-6 text-sm text-mute">
        Classement du championnat, meilleurs buteurs et meilleurs passeurs, mis à jour après chaque match.
      </p>

      <ul className={listCard}>
        {(leagues ?? []).map((league) => (
          <li key={league.id}>
            <Link
              href={`/standings/${league.football_data_code}`}
              className="flex items-center gap-3 p-4 transition-colors hover:bg-cream"
            >
              {league.logo_url && <img src={league.logo_url} alt="" className="h-8 w-8 object-contain" />}
              <div>
                <div className="font-bold">{league.name}</div>
                <div className="text-sm text-mute">{league.country}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
