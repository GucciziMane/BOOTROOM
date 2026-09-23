// Réduit la Ligue des Nations à la seule Ligue A (16 sélections, 4 groupes de 4) à la demande de
// l'utilisateur — les Ligues B/C/D (38 équipes, 108 matchs) sont supprimées intégralement, y
// compris les pronostics et abonnements "cloche de but" déjà posés dessus par d'autres joueurs
// (63 pronostics + 21 abonnements au moment de l'écriture de ce script — décision explicite de
// l'utilisateur, confirmée après lui avoir communiqué ce chiffre).
//
// Composition de la Ligue A vérifiée contre le vrai tirage ESPN 2026-27 (jamais une liste
// inventée) : https://site.api.espn.com/apis/v2/sports/soccer/uefa.nations/standings?season=2026,
// groupes "Group A1" à "Group A4".
//
// Ordre de suppression dicté par les FK réelles de la base (introspection information_schema,
// jamais le schéma généré qui peut être périmé) :
//   matches (CASCADE vers match_predictions/match_goal_subscriptions/match_goals/match_cards/
//   match_substitutions) doivent partir AVANT teams, sinon la suppression des joueurs (CASCADE
//   depuis teams) échoue à cause des colonnes NO ACTION de match_predictions vers players
//   (predicted_scorer_player_id/predicted_assist_player_id) tant que ces pronostics existent.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/prune-nations-league-to-league-a.mjs
import { Client } from "pg";

const LEAGUE_A_ESPN_IDS = new Set([
  "162", "459", "465", "478", // Group A1: Italy, Belgium, Türkiye, France
  "449", "455", "481", "6757", // Group A2: Netherlands, Greece, Germany, Serbia
  "164", "448", "450", "477", // Group A3: Spain, England, Czechia, Croatia
  "464", "479", "482", "578", // Group A4: Norway, Denmark, Portugal, Wales
]);

const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  database: "postgres",
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  const { rows: leagueRows } = await client.query(`SELECT id FROM leagues WHERE football_data_code = 'NL'`);
  if (leagueRows.length === 0) throw new Error('Ligue "NL" introuvable.');
  const leagueId = leagueRows[0].id;

  const { rows: teams } = await client.query(`SELECT id, name, football_data_id FROM teams WHERE league_id = $1`, [leagueId]);
  const nonATeams = teams.filter((t) => !LEAGUE_A_ESPN_IDS.has(String(t.football_data_id)));
  const aTeams = teams.filter((t) => LEAGUE_A_ESPN_IDS.has(String(t.football_data_id)));
  if (aTeams.length !== 16) {
    throw new Error(`Attendu 16 équipes de Ligue A trouvées en base, obtenu ${aTeams.length} — abandon par sécurité.`);
  }
  const nonATeamIds = nonATeams.map((t) => t.id);
  console.log(`${aTeams.length} équipes de Ligue A conservées, ${nonATeams.length} équipes à supprimer.`);

  const { rows: matches } = await client.query(
    `SELECT id, home_team_id, away_team_id FROM matches WHERE league_id = $1`,
    [leagueId]
  );
  const nonATeamIdSet = new Set(nonATeamIds);
  const nonAMatchIds = matches
    .filter((m) => nonATeamIdSet.has(m.home_team_id) || nonATeamIdSet.has(m.away_team_id))
    .map((m) => m.id);
  const mixed = matches.filter(
    (m) => nonATeamIdSet.has(m.home_team_id) !== nonATeamIdSet.has(m.away_team_id)
  );
  if (mixed.length > 0) {
    throw new Error(`${mixed.length} match(s) mélangent Ligue A et non-A — abandon par sécurité (vérifier manuellement).`);
  }
  console.log(`${matches.length - nonAMatchIds.length} matchs de Ligue A conservés, ${nonAMatchIds.length} matchs à supprimer.`);

  const { rows: seasonRows } = await client.query(
    `SELECT id FROM seasons WHERE league_id = $1 ORDER BY year DESC LIMIT 1`,
    [leagueId]
  );
  if (seasonRows.length === 0) throw new Error("Saison Ligue des Nations introuvable.");
  const seasonId = seasonRows[0].id;

  await client.query("BEGIN");
  try {
    // 2 season_predictions orphelines pour cette saison : la Ligue des Nations n'a jamais
    // supporté les pronostics de saison (masqués partout dans l'UI, jamais notés), mais le bug de
    // redirection corrigé plus tôt dans cette session (src/lib/supabase/middleware.ts) a laissé 2
    // joueurs réels tomber sur ce formulaire et le soumettre le 2026-09-23, avant le fix. Ces
    // lignes bloquent la suppression des équipes B/C/D qu'elles référencent (surprise_team_id/
    // flop_team_id) — supprimées avec l'accord explicite de l'utilisateur, informé du nombre exact.
    const { rowCount: seasonPredsDeleted } = await client.query(
      `DELETE FROM season_predictions WHERE season_id = $1`,
      [seasonId]
    );
    const { rowCount: predsDeleted } = await client.query(
      `DELETE FROM match_predictions WHERE match_id = ANY($1::bigint[])`,
      [nonAMatchIds]
    );
    const { rowCount: subsDeleted } = await client.query(
      `DELETE FROM match_goal_subscriptions WHERE match_id = ANY($1::bigint[])`,
      [nonAMatchIds]
    );
    const { rowCount: matchesDeleted } = await client.query(
      `DELETE FROM matches WHERE id = ANY($1::bigint[])`,
      [nonAMatchIds]
    );
    const { rowCount: teamsDeleted } = await client.query(
      `DELETE FROM teams WHERE id = ANY($1::bigint[])`,
      [nonATeamIds]
    );
    await client.query("COMMIT");
    console.log(
      `Terminé : ${seasonPredsDeleted} pronostic(s) de saison orphelin(s), ${predsDeleted} pronostics de match, ${subsDeleted} abonnements, ${matchesDeleted} matchs et ${teamsDeleted} équipes (+ leurs joueurs, cascade) supprimés.`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
