import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import { BackLink } from "@/app/BackLink";

export default async function LeaguesPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const [{ data: leagues }, { data: seasons }, { data: predictions }] = await Promise.all([
    supabase
      .from("leagues")
      .select("id, name, country, football_data_code, logo_url")
      .eq("active", true)
      .order("name"),
    supabase.from("seasons").select("id, league_id, status"),
    supabase.from("season_predictions").select("season_id").eq("user_id", user!.id),
  ]);
  const predictedSeasonIds = new Set((predictions ?? []).map((p) => p.season_id));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Championnats</h1>
        <BackLink href="/" />
      </div>

      <p className="mb-3 text-sm text-mute">
        Pronostics de saison : meilleur buteur, meilleur passeur, top 3, flop 3, équipe surprise et équipe flop.
      </p>

      <ul className={listCard}>
        {(leagues ?? []).map((league) => {
          const season = (seasons ?? []).find((s) => s.league_id === league.id);
          const predicted = season ? predictedSeasonIds.has(season.id) : false;

          return (
            <li key={league.id}>
              <Link
                href={`/leagues/${league.football_data_code}`}
                transitionTypes={["nav-forward"]}
                // Toute la liste est visible sans scroll : sans ça, chaque championnat précharge en
                // arrière-plan dès l'affichage de cette page, en concurrence avec elle-même.
                prefetch={false}
                className="flex items-center justify-between p-4 transition-colors hover:bg-cream"
              >
                <div className="flex items-center gap-3">
                  {league.logo_url && (
                    <Image
                      src={league.logo_url}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 object-contain [filter:drop-shadow(0_0_3px_rgba(255,255,255,0.9))_drop-shadow(0_0_10px_rgba(255,255,255,0.55))]"
                    />
                  )}
                  <div className="flex items-center gap-2 font-bold">
                    <span>{LEAGUE_FLAG[league.football_data_code] ?? league.country}</span>
                    <span>{league.name}</span>
                  </div>
                </div>
                <div className="text-sm font-bold">
                  {predicted ? (
                    <span className="text-good">Pronostics envoyés</span>
                  ) : (
                    <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">À faire</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
