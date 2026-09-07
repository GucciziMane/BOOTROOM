// football-data.org ne publie pas encore les effectifs de la Ligue des Champions pour la saison
// 2026-27 (saison pas commencée au moment d'ajouter la compétition — voir sync-champions-league.mjs).
// Pour les clubs qu'on suit déjà dans un championnat domestique, on a leur effectif à jour : on le
// recopie vers l'équipe C1 correspondante (même football_data_id, retrouvée via league_id != 6)
// plutôt que d'attendre. Même football_data_id conservé sur les lignes copiées : quand
// football-data.org publiera enfin les vrais effectifs C1, le sync hebdomadaire normal
// (onConflict team_id+football_data_id) les mettra à jour en place, sans doublon.
//
// Ne couvre que les clubs déjà suivis (Ligue 1, Premier League, Liga, Bundesliga, Primeira Liga) —
// les autres (Slavia Praha, Galatasaray, Club Brugge, etc.) resteront sans effectif jusqu'à
// publication par la source, comme n'importe quelle compétition tout juste ajoutée.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: league } = await supabase.from("leagues").select("id").eq("football_data_code", "CL").single();
  const { data: clTeams } = await supabase.from("teams").select("id, name, football_data_id").eq("league_id", league.id);
  const { data: otherTeams } = await supabase
    .from("teams")
    .select("id, name, football_data_id, league_id")
    .neq("league_id", league.id);
  const otherByFdId = new Map((otherTeams ?? []).map((t) => [t.football_data_id, t]));

  let copiedTeams = 0;
  let copiedPlayers = 0;
  const skipped = [];

  for (const clTeam of clTeams ?? []) {
    const source = otherByFdId.get(clTeam.football_data_id);
    if (!source) {
      skipped.push(clTeam.name);
      continue;
    }

    const { data: players } = await supabase
      .from("players")
      .select("name, position, football_data_id, photo_url")
      .eq("team_id", source.id)
      .is("left_at", null);

    if (!players || players.length === 0) continue;

    const rows = players
      .filter((p) => p.football_data_id != null)
      .map((p) => ({
        team_id: clTeam.id,
        name: p.name,
        position: p.position,
        football_data_id: p.football_data_id,
        photo_url: p.photo_url,
        left_at: null,
        updated_at: new Date().toISOString(),
      }));
    if (rows.length === 0) continue;

    const { error } = await supabase.from("players").upsert(rows, { onConflict: "team_id,football_data_id" });
    if (error) {
      console.error(`${clTeam.name}: échec upsert -`, error.message);
      continue;
    }
    copiedTeams++;
    copiedPlayers += rows.length;
    console.log(`${clTeam.name} <- ${source.name}: ${rows.length} joueurs`);
  }

  console.log(`\nTotal: ${copiedPlayers} joueurs copiés pour ${copiedTeams} équipes.`);
  console.log(`Toujours sans effectif (club hors championnats suivis) : ${skipped.join(", ")}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
