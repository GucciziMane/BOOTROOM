import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { BackLink } from "@/app/BackLink";
import { BallonDorIcon } from "@/app/BallonDorIcon";
import { BallonDorRunner } from "./BallonDorRunner";

const EDITION_YEAR = 2026;

export default async function BallonDorPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) redirect("/login");

  const admin = createServiceRoleClient();

  const [{ data: nominees }, { data: edition }, { data: prediction }, { data: profile }] = await Promise.all([
    admin
      .from("ballon_dor_nominees")
      .select("id, name, club_name, photo_url")
      .eq("edition_year", EDITION_YEAR)
      .order("display_order", { ascending: true }),
    admin.from("ballon_dor_editions").select("predictions_lock_at, points_processed_at").eq("year", EDITION_YEAR).maybeSingle(),
    admin.from("ballon_dor_predictions").select("picks").eq("user_id", user.id).eq("edition_year", EDITION_YEAR).maybeSingle(),
    admin.from("profiles").select("username, avatar_url").eq("id", user.id).single(),
  ]);

  const locked = edition ? new Date(edition.predictions_lock_at) <= new Date() : false;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-28 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BallonDorIcon className="h-7 w-7" />
          Ballon d&apos;Or 2026
        </h1>
        <BackLink href="/" />
      </div>

      <BallonDorRunner
        nominees={nominees ?? []}
        initialPicks={(prediction?.picks as Record<string, number>) ?? {}}
        locked={locked}
        username={profile?.username ?? "?"}
        avatarUrl={profile?.avatar_url ?? null}
      />
    </main>
  );
}
