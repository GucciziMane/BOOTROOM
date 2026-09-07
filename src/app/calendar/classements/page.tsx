import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import { BackLink } from "@/app/BackLink";
import { CalendarTabs } from "../CalendarTabs";

export default async function CalendarStandingsPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, country, football_data_code, logo_url")
    .eq("active", true)
    .order("name");

  const leagueIds = (leagues ?? []).map((l) => l.id);
  const [{ data: seasons }, { data: predictions }] = await Promise.all([
    supabase
      .from("seasons")
      .select("id, league_id, predictions_lock_at")
      .in("league_id", leagueIds.length > 0 ? leagueIds : [-1])
      .order("year", { ascending: false }),
    supabase.from("season_predictions").select("season_id").eq("user_id", user!.id),
  ]);
  const currentSeasonByLeague = new Map<number, { id: number; predictions_lock_at: string }>();
  for (const s of seasons ?? []) {
    if (!currentSeasonByLeague.has(s.league_id)) currentSeasonByLeague.set(s.league_id, s);
  }
  const predictedSeasonIds = new Set((predictions ?? []).map((p) => p.season_id));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pronostics</h1>
        <BackLink href="/" />
      </div>

      <CalendarTabs active="classements" />

      <p className="mb-6 text-sm text-mute">
        Classement du championnat, meilleurs buteurs et meilleurs passeurs, mis à jour après chaque match.
      </p>

      <ul className={listCard}>
        {(leagues ?? []).map((league) => {
          const season = currentSeasonByLeague.get(league.id);
          const predictionPending =
            season && new Date(season.predictions_lock_at) > new Date() && !predictedSeasonIds.has(season.id);

          return (
            <li key={league.id}>
              <Link
                href={`/calendar/classements/${league.football_data_code}`}
                transitionTypes={["nav-forward"]}
                className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-cream"
              >
                <div className="flex items-center gap-3">
                  {league.logo_url && (
                    <Image src={league.logo_url} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
                  )}
                  <div className="flex items-center gap-2 font-bold">
                    <span>{LEAGUE_FLAG[league.football_data_code] ?? league.country}</span>
                    <span>{league.name}</span>
                  </div>
                </div>
                {predictionPending && (
                  <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
                    🔮 Pronostic de saison à faire
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
