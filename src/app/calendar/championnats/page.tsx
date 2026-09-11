import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { listCard } from "@/lib/ui";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import { BackLink } from "@/app/BackLink";
import { CalendarTabs } from "../CalendarTabs";

export default async function CalendarLeaguesPage() {
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
        <BackLink href="/" />
      </div>

      <CalendarTabs active="leagues" />

      <p className="mb-6 text-sm text-mute">
        Choisis un championnat pour voir le calendrier et pronostiquer un score + un buteur, match par match.
      </p>

      <ul className={listCard}>
        {(leagues ?? []).map((league) => (
          <li key={league.id}>
            <Link
              href={`/leagues/${league.football_data_code}/calendar`}
              // Toute la liste est visible sans scroll : sans ça, chaque championnat (une page à
              // plusieurs allers-retours Supabase) précharge en arrière-plan dès l'affichage de
              // cette page, en concurrence avec elle-même.
              prefetch={false}
              className="flex items-center gap-3 p-4 transition-colors hover:bg-cream"
            >
              {league.logo_url && (
                // Contour net (pas de halo rond ni de pastille) qui épouse la silhouette exacte
                // du blason — un drop-shadow à faible flou, doublé pour l'intensité, dessine un
                // liseré fin plutôt qu'une lueur diffuse.
                <Image
                  src={league.logo_url}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 object-contain [filter:drop-shadow(0_0_1px_rgba(255,255,255,0.95))_drop-shadow(0_0_1px_rgba(255,255,255,0.95))_drop-shadow(0_0_2.5px_rgba(255,255,255,0.7))]"
                />
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
