import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { bannerWarn, linkMuted, listCard } from "@/lib/ui";

export default async function LeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, country, football_data_code, logo_url")
    .eq("active", true)
    .order("name");

  const { data: seasons } = await supabase.from("seasons").select("id, league_id, predictions_lock_at, status");

  const { data: predictions } = await supabase
    .from("season_predictions")
    .select("season_id")
    .eq("user_id", user!.id);
  const predictedSeasonIds = new Set((predictions ?? []).map((p) => p.season_id));
  const nextLockAt = (seasons ?? [])
    .map((s) => s.predictions_lock_at)
    .filter((d) => new Date(d) > new Date())
    .sort()[0];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Championnats</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <p className="mb-3 text-sm text-mute">
        Pronostics de saison : meilleur buteur, meilleur passeur, top 3, flop 3, équipe surprise et équipe flop.
      </p>

      {nextLockAt && (
        <div className={`mb-6 ${bannerWarn}`}>
          Pronostics à envoyer avant le <strong>{formatParisDateTime(nextLockAt)}</strong> — plus aucune
          modification possible après.
        </div>
      )}

      <ul className={listCard}>
        {(leagues ?? []).map((league) => {
          const season = (seasons ?? []).find((s) => s.league_id === league.id);
          const locked = season ? new Date(season.predictions_lock_at) <= new Date() : false;
          const predicted = season ? predictedSeasonIds.has(season.id) : false;

          return (
            <li key={league.id}>
              <Link
                href={`/leagues/${league.football_data_code}`}
                className="flex items-center justify-between p-4 transition-colors hover:bg-cream"
              >
                <div className="flex items-center gap-3">
                  {league.logo_url && <img src={league.logo_url} alt="" className="h-8 w-8 object-contain" />}
                  <div>
                    <div className="font-bold">{league.name}</div>
                    <div className="text-sm text-mute">{league.country}</div>
                  </div>
                </div>
                <div className="text-sm font-bold">
                  {predicted ? (
                    <span className="text-good">Pronostics envoyés</span>
                  ) : locked ? (
                    <span className="text-mute">Verrouillé</span>
                  ) : (
                    <span className="text-ink underline decoration-2 underline-offset-2">À faire</span>
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
