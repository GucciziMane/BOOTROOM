import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { BackLink } from "@/app/BackLink";
import { BallonDorIcon } from "@/app/BallonDorIcon";
import { BallonDorRunner } from "./BallonDorRunner";
import { BallonDorSubmittedList, type SubmittedEntry } from "./BallonDorSubmittedList";
import { BallonDorBackground } from "./BallonDorBackground";
import { computeBallonDorPoints } from "@/lib/scoring/ballon-dor";

const EDITION_YEAR = 2026;

export default async function BallonDorPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();

  const [{ data: nominees }, { data: edition }, { data: myPrediction }, { data: profile }] = await Promise.all([
    admin
      .from("ballon_dor_nominees")
      .select("id, name, club_name, photo_url")
      .eq("edition_year", EDITION_YEAR)
      .order("display_order", { ascending: true }),
    admin
      .from("ballon_dor_editions")
      .select(
        "predictions_lock_at, points_processed_at, rank_1_nominee_id, rank_2_nominee_id, rank_3_nominee_id, rank_4_nominee_id, rank_5_nominee_id, rank_6_nominee_id, rank_7_nominee_id, rank_8_nominee_id, rank_9_nominee_id, rank_10_nominee_id"
      )
      .eq("year", EDITION_YEAR)
      .maybeSingle(),
    admin.from("ballon_dor_predictions").select("picks").eq("user_id", user.id).eq("edition_year", EDITION_YEAR).maybeSingle(),
    admin.from("profiles").select("username, avatar_url").eq("id", user.id).single(),
  ]);

  const locked = edition ? new Date(edition.predictions_lock_at) <= new Date() : false;
  // Verrouillage individuel dès le premier envoi (voir migration 0061, plus aucune policy UPDATE) :
  // une fois qu'un pronostic existe pour ce compte, on ne remonte plus jamais le formulaire.
  const hasSubmitted = Boolean(myPrediction);

  const header = (
    <div className="mb-3 flex items-center justify-between">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <BallonDorIcon className="h-7 w-7" />
        Ballon d&apos;Or 2026
      </h1>
      <BackLink href="/" />
    </div>
  );

  if (hasSubmitted || locked) {
    // Client authentifié (pas admin) : laisse Postgres appliquer lui-même la règle de la migration
    // 0061 (les autres ne sont visibles que si le mien existe déjà, ou une fois verrouillé) —
    // l'admin bypasserait cette RLS et montrerait les pronostics des autres à tort.
    const { data: allPredictions } = await supabase
      .from("ballon_dor_predictions")
      .select("user_id, picks, updated_at")
      .eq("edition_year", EDITION_YEAR)
      .order("updated_at", { ascending: true });

    const userIds = (allPredictions ?? []).map((p) => p.user_id);
    const { data: profiles } =
      userIds.length > 0 ? await admin.from("profiles").select("id, username, avatar_url").in("id", userIds) : { data: [] };
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    // Résultat réel affiché seulement une fois les points payés (processBallonDor) : avant, les
    // rangs peuvent être partiellement saisis et un "+0" provisoire induirait en erreur.
    const actual: Record<number, number | null> | null =
      edition?.points_processed_at != null
        ? {
            1: edition.rank_1_nominee_id,
            2: edition.rank_2_nominee_id,
            3: edition.rank_3_nominee_id,
            4: edition.rank_4_nominee_id,
            5: edition.rank_5_nominee_id,
            6: edition.rank_6_nominee_id,
            7: edition.rank_7_nominee_id,
            8: edition.rank_8_nominee_id,
            9: edition.rank_9_nominee_id,
            10: edition.rank_10_nominee_id,
          }
        : null;

    const submitted: SubmittedEntry[] = (allPredictions ?? []).map((p) => ({
      userId: p.user_id,
      username: profileById.get(p.user_id)?.username ?? "?",
      avatarUrl: profileById.get(p.user_id)?.avatar_url ?? null,
      picks: p.picks as Record<string, number>,
      isMe: p.user_id === user.id,
      totalPoints: actual ? computeBallonDorPoints(p.picks as Record<string, number>, actual) : null,
    }));
    if (actual) submitted.sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));

    return (
      <BallonDorBackground>
        <main className="mx-auto w-full max-w-2xl px-6 pb-28 pt-4">
          {header}
          <p className="mb-4 text-center text-sm text-mute">
            {actual
              ? "Résultats officiels tombés : chaque place exacte rapporte des points (classement par points gagnés)."
              : hasSubmitted
                ? "Ton pronostic est enregistré et ne peut plus être modifié. Voici ceux des autres joueurs qui ont déjà validé le leur."
                : "Les pronostics sont verrouillés."}
          </p>
          <BallonDorSubmittedList nominees={nominees ?? []} submitted={submitted} actual={actual} />
        </main>
      </BallonDorBackground>
    );
  }

  return (
    <BallonDorBackground>
      <main className="mx-auto w-full max-w-2xl px-6 pb-28 pt-4">
        {header}
        <BallonDorRunner nominees={nominees ?? []} username={profile?.username ?? "?"} avatarUrl={profile?.avatar_url ?? null} />
      </main>
    </BallonDorBackground>
  );
}
