import { createClient } from "@/lib/supabase/server";
import { getPredictionHistory } from "@/lib/predictions";
import { BackLink } from "@/app/BackLink";
import { CalendarTabs } from "../CalendarTabs";
import { PredictionHistoryList } from "./PredictionHistoryList";

export default async function MyPredictionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rows = await getPredictionHistory(supabase, user!.id);
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
          Tous tes pronostics depuis le début, du plus récent au plus ancien —{" "}
          <strong className="text-ink">{rows.length}</strong> pronostic{rows.length > 1 ? "s" : ""}, pour un total de{" "}
          <strong className="text-ink">{totalPointsSum} pts</strong>.
        </p>

        <PredictionHistoryList rows={rows} />
      </section>
    </main>
  );
}
