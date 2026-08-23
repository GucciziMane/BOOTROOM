import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/format-date";
import { bannerWarn, bannerNeutral, linkMuted, card } from "@/lib/ui";
import { SeasonPredictionForm, type PlayerOption, type TeamOption } from "./SeasonPredictionForm";

export default async function LeagueSeasonPage({ params }: PageProps<"/leagues/[code]">) {
  const { code } = await params;
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: league },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("leagues").select("id, name, football_data_code, active").eq("football_data_code", code).maybeSingle(),
  ]);

  if (!league || !league.active) notFound();

  const [{ data: seasons }, { data: teamsData }] = await Promise.all([
    supabase
      .from("seasons")
      .select("id, year, predictions_lock_at, status")
      .eq("league_id", league.id)
      .order("year", { ascending: false })
      .limit(1),
    supabase.from("teams").select("id, name, logo_url").eq("league_id", league.id).order("name"),
  ]);
  const season = seasons?.[0];

  if (!season) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        <p className="mt-4 text-mute">Saison pas encore synchronisée.</p>
      </main>
    );
  }

  const teams: TeamOption[] = (teamsData ?? []).map((t) => ({ id: t.id, name: t.name, logoUrl: t.logo_url }));
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const [{ data: playersData }, { data: existing }] = await Promise.all([
    supabase
      .from("players")
      .select("id, name, team_id")
      .in("team_id", teams.map((t) => t.id))
      .order("name"),
    supabase
      .from("season_predictions")
      .select("top_scorer_player_id, top_assist_player_id, top3, bottom3, surprise_team_id, flop_team_id")
      .eq("user_id", user!.id)
      .eq("season_id", season.id)
      .maybeSingle(),
  ]);
  const players: PlayerOption[] = (playersData ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    teamId: p.team_id,
    teamName: teamNameById.get(p.team_id) ?? "",
  }));

  const locked = new Date(season.predictions_lock_at) <= new Date();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        <Link href="/leagues" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>

      <div className={`mb-6 ${locked ? bannerNeutral : bannerWarn}`}>
        {locked
          ? `Pronostics verrouillés depuis le ${formatParisDateTime(season.predictions_lock_at)}.`
          : `Pronostics à envoyer avant le ${formatParisDateTime(season.predictions_lock_at)} — plus aucune modification possible après.`}
      </div>

      {locked ? (
        <div className={card}>
          <LockedSummary existing={existing ?? null} teams={teams} players={players} />
        </div>
      ) : (
        <SeasonPredictionForm
          leagueCode={code}
          seasonId={season.id}
          teams={teams}
          players={players}
          teamsCount={teams.length}
          initial={{
            topScorerPlayerId: existing?.top_scorer_player_id ?? null,
            topAssistPlayerId: existing?.top_assist_player_id ?? null,
            top3: (existing?.top3 as Record<string, number>) ?? {},
            bottom3: (existing?.bottom3 as Record<string, number>) ?? {},
            surpriseTeamId: existing?.surprise_team_id ?? null,
            flopTeamId: existing?.flop_team_id ?? null,
          }}
        />
      )}
    </main>
  );
}

function LockedSummary({
  existing,
  teams,
  players,
}: {
  existing: {
    top_scorer_player_id: number | null;
    top_assist_player_id: number | null;
    top3: unknown;
    bottom3: unknown;
    surprise_team_id: number | null;
    flop_team_id: number | null;
  } | null;
  teams: TeamOption[];
  players: PlayerOption[];
}) {
  if (!existing) {
    return <p className="text-mute">Tu n&apos;as pas soumis de pronostics avant le verrouillage.</p>;
  }

  const teamName = (id: number | null) => teams.find((t) => t.id === id)?.name ?? "—";
  const playerName = (id: number | null) => players.find((p) => p.id === id)?.name ?? "—";
  const top3 = (existing.top3 as Record<string, number>) ?? {};
  const bottom3 = (existing.bottom3 as Record<string, number>) ?? {};

  return (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-mute">Meilleur buteur</dt>
        <dd className="text-lg font-bold">{playerName(existing.top_scorer_player_id)}</dd>
      </div>
      <div>
        <dt className="text-mute">Meilleur passeur</dt>
        <dd className="text-lg font-bold">{playerName(existing.top_assist_player_id)}</dd>
      </div>
      <div>
        <dt className="text-mute">Top 3</dt>
        <dd className="text-lg font-bold">{[1, 2, 3].map((r) => teamName(top3[String(r)])).join(", ")}</dd>
      </div>
      <div>
        <dt className="text-mute">Flop 3</dt>
        <dd className="text-lg font-bold">{[1, 2, 3].map((r) => teamName(bottom3[String(r)])).join(", ")}</dd>
      </div>
      <div>
        <dt className="text-mute">Équipe surprise</dt>
        <dd className="text-lg font-bold">{teamName(existing.surprise_team_id)}</dd>
      </div>
      <div>
        <dt className="text-mute">Équipe flop</dt>
        <dd className="text-lg font-bold">{teamName(existing.flop_team_id)}</dd>
      </div>
    </dl>
  );
}
