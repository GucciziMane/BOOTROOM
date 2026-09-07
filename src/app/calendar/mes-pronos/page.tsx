import { createClient } from "@/lib/supabase/server";
import { getPredictionHistory } from "@/lib/predictions";
import { BackLink } from "@/app/BackLink";
import { CalendarTabs } from "../CalendarTabs";
import { PredictionHistoryList } from "./PredictionHistoryList";

export default async function MyPredictionsPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const allRows = await getPredictionHistory(supabase, user!.id);
  // Seulement les pronostics déjà notés : un match pas encore joué (ou pas encore traité par le
  // cron de points) n'a rien à montrer ici, il encombrait la page avec des cartes "à venir".
  const rows = allRows.filter((r) => r.totalPoints != null);
  const totalPointsSum = rows.reduce((sum, r) => sum + (r.totalPoints ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pronostics</h1>
        <BackLink href="/" />
      </div>

      <CalendarTabs active="mine" />

      <section>
        <p className="mb-4 text-sm text-mute">
          Tous tes pronostics déjà notés, du plus récent au plus ancien —{" "}
          <strong className="text-ink">{rows.length}</strong> pronostic{rows.length > 1 ? "s" : ""}, pour un total de{" "}
          <strong className="text-ink">{totalPointsSum} pts</strong>.
        </p>

        <PredictionHistoryList rows={rows} />
      </section>
    </main>
  );
}
