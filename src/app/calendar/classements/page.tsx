import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { linkMuted, listCard } from "@/lib/ui";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import { CalendarTabs } from "../CalendarTabs";

export default async function CalendarStandingsPage() {
  const supabase = await createClient();

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, country, football_data_code, logo_url")
    .eq("active", true)
    .order("name");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pronostics</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <CalendarTabs active="classements" />

      <p className="mb-6 text-sm text-mute">
        Classement du championnat, meilleurs buteurs et meilleurs passeurs, mis à jour après chaque match.
      </p>

      <ul className={listCard}>
        {(leagues ?? []).map((league) => (
          <li key={league.id}>
            <Link
              href={`/calendar/classements/${league.football_data_code}`}
              className="flex items-center gap-3 p-4 transition-colors hover:bg-cream"
            >
              {league.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- crest hosted on football-data.org, pas dans les remotePatterns next/image
                <img src={league.logo_url} alt="" className="h-8 w-8 object-contain" />
              )}
              <div className="flex items-center gap-2 font-bold">
                <span>{LEAGUE_FLAG[league.football_data_code] ?? league.country}</span>
                <span>{league.name}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
