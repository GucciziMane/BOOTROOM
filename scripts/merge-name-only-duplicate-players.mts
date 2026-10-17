// Fusion ponctuelle (17/10/2026) des joueurs en double "ligne Wikipédia sans id football-data" +
// "ligne football-data" dans un même club (Sabah FK, SK Slavia Praha) — voir
// adoptNameOnlyDuplicates dans sync-teams-players, qui empêche désormais d'en recréer.
// Redirige toutes les références vers la ligne football-data puis marque la ligne Wikipédia partie.
// Ne touche jamais points_ledger. Dry-run par défaut ; `--apply` pour exécuter (une transaction).
//   npx tsx scripts/merge-name-only-duplicate-players.mts [--apply]
import { Client } from "pg";
import { normalizeName } from "../src/lib/sync/name-match";

const apply = process.argv.includes("--apply");
const c = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  database: "postgres",
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const players = (
  await c.query(`select id, team_id, name, football_data_id, photo_url from players where left_at is null`)
).rows;
const groups = new Map<string, typeof players>();
for (const p of players) {
  const key = `${p.team_id}|${normalizeName(p.name)}`;
  groups.set(key, [...(groups.get(key) ?? []), p]);
}
const pairs = [...groups.values()].flatMap((g) => {
  const nameOnly = g.filter((p) => p.football_data_id == null);
  const withFd = g.filter((p) => p.football_data_id != null);
  return nameOnly.length === 1 && withFd.length === 1 ? [{ from: nameOnly[0], to: withFd[0] }] : [];
});
console.log(`${pairs.length} paires à fusionner`);

const REFS: Array<[string, string]> = [
  ["match_predictions", "predicted_scorer_player_id"],
  ["match_predictions", "predicted_assist_player_id"],
  ["season_predictions", "top_scorer_player_id"],
  ["season_predictions", "top_assist_player_id"],
  ["match_goals", "player_id"],
  ["match_goals", "assist_player_id"],
  ["match_substitutions", "player_out_id"],
  ["match_substitutions", "player_in_id"],
  ["match_cards", "player_id"],
];

await c.query("begin");
try {
  const totals = new Map<string, number>();
  for (const { from, to } of pairs) {
    for (const [table, col] of REFS) {
      const r = await c.query(`update ${table} set ${col} = $1 where ${col} = $2`, [to.id, from.id]);
      if (r.rowCount) totals.set(`${table}.${col}`, (totals.get(`${table}.${col}`) ?? 0) + r.rowCount);
    }
    for (const table of ["player_scoring_tier", "player_assist_tier"]) {
      // La ligne football-data a déjà son propre palier (recalculé chaque jour) : on garde le sien.
      await c.query(
        `delete from ${table} f where f.player_id = $2 and exists (select 1 from ${table} t where t.player_id = $1 and t.season_id = f.season_id)`,
        [to.id, from.id]
      );
      await c.query(`update ${table} set player_id = $1 where player_id = $2`, [to.id, from.id]);
    }
    if (!to.photo_url && from.photo_url) {
      await c.query(`update players set photo_url = $1 where id = $2`, [from.photo_url, to.id]);
    }
    await c.query(`update players set left_at = now() where id = $1`, [from.id]);
  }
  console.log("références redirigées :", Object.fromEntries(totals));
  await c.query(apply ? "commit" : "rollback");
  console.log(apply ? "APPLIQUÉ" : "dry-run (rollback) — relancer avec --apply");
} catch (err) {
  await c.query("rollback");
  throw err;
} finally {
  await c.end();
}
