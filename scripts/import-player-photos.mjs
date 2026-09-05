// Contrairement à import-wikipedia-squads.mjs (qui insère/mets à jour/supprime tout l'effectif),
// ce script ne touche QUE photo_url sur des joueurs déjà en base, appariés par nom — jamais
// d'insertion ni de suppression. Objectif : ajouter les photos sans risquer d'effacer un joueur
// réel à cause d'un souci de parsing sur une page Wikipédia précise.
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
    const { data: teamRow, error: teamErr } = await supabase.from("teams").select("id").eq("name", t.team).maybeSingle();
    if (teamErr || !teamRow) {
      summary.push({ team: t.team, error: "team not found in DB" });
      continue;
    }
    const teamId = teamRow.id;

    const { data: existing } = await supabase.from("players").select("id, name").eq("team_id", teamId).is("left_at", null);
    const existingByNorm = new Map((existing ?? []).map((p) => [normalize(p.name), p]));

    let updated = 0;
    let noPhoto = 0;
    let unmatched = 0;

    for (const p of t.players) {
      if (!p.photoUrl) {
        noPhoto++;
        continue;
      }
      const norm = normalize(p.name);
      let match = existingByNorm.get(norm);
      if (!match) {
        const lastName = norm.split(" ").pop();
        const candidates = (existing ?? []).filter((e) => normalize(e.name).split(" ").pop() === lastName);
        if (candidates.length === 1) match = candidates[0];
      }
      if (!match) {
        unmatched++;
        continue;
      }
      await supabase.from("players").update({ photo_url: p.photoUrl }).eq("id", match.id);
      updated++;
    }

    summary.push({ team: t.team, updated, noPhoto, unmatched });
  }

  return summary;
}

const files = process.argv.slice(2);
for (const file of files) {
  console.log(`--- ${file} ---`);
  const summary = await importFile(file);
  for (const s of summary) console.log(JSON.stringify(s));
}
