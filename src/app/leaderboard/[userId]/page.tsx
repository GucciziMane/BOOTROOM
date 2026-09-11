import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPredictionHistory } from "@/lib/predictions";
import { PredictionHistoryList } from "@/app/calendar/mes-pronos/PredictionHistoryList";
import { BackLink } from "@/app/BackLink";

export default async function PlayerPredictionsPage({ params }: PageProps<"/leaderboard/[userId]">) {
  const { userId } = await params;
  const supabase = await createClient();

  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const { data: profile } = await supabase.from("profiles").select("id, username").eq("id", userId).maybeSingle();
  if (!profile) notFound();

  const isSelf = user?.id === profile.id;
  const [rows, { data: trophy }] = await Promise.all([
    getPredictionHistory(supabase, profile.id),
    // Trophée mi-saison (voir migration 0049) : permanent, le plus récent si plusieurs années.
    supabase
      .from("midseason_bonuses")
      .select("rank, season_year")
      .eq("user_id", profile.id)
      .order("season_year", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const totalPointsSum = rows.reduce((sum, r) => sum + (r.totalPoints ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          {isSelf ? "Mes pronostics" : `Pronostics de ${profile.username}`}
          {trophy && (
            <span className="text-2xl" title={`Top ${trophy.rank} mi-saison ${trophy.season_year}`}>
              🏆
            </span>
          )}
        </h1>
        <BackLink href="/leaderboard">Retour au classement</BackLink>
      </div>

      <section>
        <p className="mb-4 text-sm text-mute">
          {isSelf ? "Tous tes pronostics" : `Tous les pronostics de ${profile.username}`} depuis le début, du plus
          récent au plus ancien — <strong className="text-ink">{rows.length}</strong> pronostic
          {rows.length > 1 ? "s" : ""}, pour un total de <strong className="text-ink">{totalPointsSum} pts</strong>.
          {!isSelf && (
            <>
              {" "}
              Les pronostics pas encore verrouillés de {profile.username} restent privés jusqu&apos;au coup d&apos;envoi.
            </>
          )}
        </p>

        <PredictionHistoryList rows={rows} />
      </section>
    </main>
  );
}
