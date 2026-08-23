import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SPECIAL = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ł: "l", ı: "i" };
function normalize(raw) {
  return raw
    .toLowerCase()
    .replace(/[øæœßđłı]/g, (c) => SPECIAL[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function importFile(path) {
  const teams = JSON.parse(readFileSync(path, "utf8"));
  const summary = [];

  for (const t of teams) {
    const { data: teamRow, error: teamErr } = await supabase
      .from("teams")
      .select("id")
      .eq("name", t.team)
      .maybeSingle();

    if (teamErr || !teamRow) {
      summary.push({ team: t.team, error: "team not found in DB" });
      continue;
    }
    const teamId = teamRow.id;

    const { data: existing } = await supabase.from("players").select("id, name").eq("team_id", teamId);
    const existingByNorm = new Map((existing ?? []).map((p) => [normalize(p.name), p]));
    const matchedIds = new Set();
    let updated = 0;
    let inserted = 0;

    for (const p of t.players) {
      const norm = normalize(p.name);
      let match = existingByNorm.get(norm);

      if (!match) {
        const lastName = norm.split(" ").pop();
        const candidates = (existing ?? []).filter((e) => normalize(e.name).split(" ").pop() === lastName);
        if (candidates.length === 1) match = candidates[0];
      }

      if (match) {
        matchedIds.add(match.id);
        await supabase
          .from("players")
          .update({ name: p.name, position: p.position, updated_at: new Date().toISOString() })
          .eq("id", match.id);
        updated++;
      } else {
        const { data: insertedRow, error: insertErr } = await supabase
          .from("players")
          .insert({
            team_id: teamId,
            name: p.name,
            position: p.position,
            football_data_id: null,
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (!insertErr && insertedRow) {
          matchedIds.add(insertedRow.id);
          inserted++;
        }
      }
    }

    const staleIds = (existing ?? []).filter((e) => !matchedIds.has(e.id)).map((e) => e.id);
    let deleted = 0;
    let deleteBlocked = 0;
    for (const id of staleIds) {
      const { error: delErr } = await supabase.from("players").delete().eq("id", id);
      if (delErr) deleteBlocked++;
      else deleted++;
    }

    summary.push({ team: t.team, updated, inserted, deleted, deleteBlocked });
  }

  return summary;
}

const files = process.argv.slice(2);
for (const file of files) {
  console.log(`--- ${file} ---`);
  const summary = await importFile(file);
  for (const s of summary) console.log(JSON.stringify(s));
}
