// Synchronise les effectifs (listes officielles convoquées) des 54 sélections de la Ligue des
// Nations depuis ESPN — à relancer avant chaque trêve internationale (les convocations changent
// à chaque fois, contrairement à un effectif de club), voir la mémoire projet sur ce choix.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/sync-nations-league-squads.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ESPN_SLUG = "uefa.nations";

// ESPN dit "Forward", notre contrainte de base dit "Attacker" (même poste, juste un nom différent
// — voir players_position_check) ; tout le reste correspond déjà tel quel.
const POSITION_MAP = { Forward: "Attacker", Goalkeeper: "Goalkeeper", Defender: "Defender", Midfielder: "Midfielder" };

async function espnFetch(path) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer${path}`);
  if (!res.ok) throw new Error(`ESPN ${path} a échoué: ${res.status}`);
  return res.json();
}

async function main() {
  const { data: league } = await supabase.from("leagues").select("id").eq("football_data_code", "NL").maybeSingle();
  if (!league) throw new Error('Ligue "NL" introuvable — lancer scripts/sync-nations-league.mjs d\'abord.');

  const { data: teams } = await supabase.from("teams").select("id, name, football_data_id").eq("league_id", league.id);
  console.log(`${teams.length} équipes à synchroniser.`);

  let totalUpserted = 0;
  const safeTeamIds = [];
  const perTeamRows = new Map();

  for (const team of teams) {
    let roster;
    try {
      roster = await espnFetch(`/${ESPN_SLUG}/teams/${team.football_data_id}/roster`);
    } catch (err) {
      console.log(`  ${team.name}: échec (${err.message}), ignoré ce run.`);
      continue;
    }
    const athletes = roster.athletes ?? [];
    if (athletes.length === 0) {
      console.log(`  ${team.name}: aucune liste convoquée publiée pour l'instant (pas de trêve en cours ?), ignoré.`);
      continue;
    }

    const rows = athletes
      .map((a) => {
        const espnPosition = a.position?.name;
        const position = POSITION_MAP[espnPosition];
        if (!position) {
          console.log(`  ${team.name}: poste ESPN inconnu "${espnPosition}" pour ${a.fullName}, joueur ignoré.`);
          return null;
        }
        return {
          team_id: team.id,
          name: a.fullName ?? a.displayName,
          position,
          football_data_id: Number(a.id),
        };
      })
      .filter(Boolean);

    perTeamRows.set(team.id, rows);
    safeTeamIds.push(team.id);
  }

  // Même garde-fou que sync-teams-players (club) : une liste qui rétrécirait de plus de moitié
  // d'un coup est plus probablement une réponse ESPN tronquée qu'une vraie vague de forfaits —
  // dans ce cas on garde l'effectif existant pour cette équipe plutôt que de marquer des joueurs
  // "partis" à tort.
  const { data: currentActive } = await supabase
    .from("players")
    .select("team_id")
    .in("team_id", safeTeamIds)
    .is("left_at", null);
  const currentCountByTeam = new Map();
  for (const row of currentActive ?? []) currentCountByTeam.set(row.team_id, (currentCountByTeam.get(row.team_id) ?? 0) + 1);

  const finalTeamIds = safeTeamIds.filter((teamId) => {
    const before = currentCountByTeam.get(teamId) ?? 0;
    const now = perTeamRows.get(teamId).length;
    return before === 0 || now >= before / 2;
  });

  const allRows = finalTeamIds.flatMap((teamId) => perTeamRows.get(teamId));
  if (allRows.length > 0) {
    const { error } = await supabase
      .from("players")
      .upsert(allRows.map((r) => ({ ...r, left_at: null, updated_at: new Date().toISOString() })), {
        onConflict: "team_id,football_data_id",
      });
    if (error) throw new Error(`Upsert joueurs: ${error.message}`);
    totalUpserted = allRows.length;
  }

  // Convoqué la dernière fois mais plus cette fois-ci (dans une équipe dont la liste actuelle
  // n'est pas suspecte, cf. garde-fou plus haut) : marqué "parti" pour cette période — ne bloque
  // pas un futur retour, juste un nouveau upsert le réactivera (même football_data_id) la
  // prochaine fois qu'il est reconvoqué.
  let totalMarkedLeft = 0;
  for (const teamId of finalTeamIds) {
    const syncedFdIds = perTeamRows.get(teamId).map((r) => r.football_data_id);
    const { data: marked } = await supabase
      .from("players")
      .update({ left_at: new Date().toISOString() })
      .eq("team_id", teamId)
      .is("left_at", null)
      .not("football_data_id", "in", `(${syncedFdIds.join(",") || "0"})`)
      .select("id");
    totalMarkedLeft += marked?.length ?? 0;
  }

  console.log(`Terminé : ${totalUpserted} joueurs synchronisés (${finalTeamIds.length}/${teams.length} équipes), ${totalMarkedLeft} marqués partis.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
