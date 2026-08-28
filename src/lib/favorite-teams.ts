import type { createClient } from "@/lib/supabase/server";
import { LEAGUE_FLAG } from "@/lib/country-flags";
import type { LeagueGroup } from "@/app/profile/FavoriteTeamPicker";

type SupaClient = Awaited<ReturnType<typeof createClient>>;

/** Équipes des championnats actifs, groupées par championnat, pour le sélecteur de club favori. */
export async function getFavoriteTeamLeagueGroups(supabase: SupaClient): Promise<LeagueGroup[]> {
  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, football_data_code")
    .eq("active", true)
    .order("name");

  const leagueIds = (leagues ?? []).map((l) => l.id);
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, logo_url, league_id")
    .in("league_id", leagueIds.length > 0 ? leagueIds : [-1])
    .order("name");

  const teamsByLeague = new Map<number, LeagueGroup["teams"]>();
  for (const t of teams ?? []) {
    if (!teamsByLeague.has(t.league_id)) teamsByLeague.set(t.league_id, []);
    teamsByLeague.get(t.league_id)!.push({ id: t.id, name: t.name, logoUrl: t.logo_url });
  }

  return (leagues ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    flag: LEAGUE_FLAG[l.football_data_code] ?? "",
    teams: teamsByLeague.get(l.id) ?? [],
  }));
}
