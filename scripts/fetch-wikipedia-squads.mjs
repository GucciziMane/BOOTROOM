import { writeFileSync } from "node:fs";

const UA = "AppFootBot/1.0 (private project, contact: ismael.mansouri@gmail.com)";
const SQUAD_SECTION_TITLES = [
  "current squad",
  "first-team squad",
  "first team squad",
  "first-team",
  "first team",
  "squad",
];

const POSITION_MAP = { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Attacker" };

async function mwApi(params) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({ ...params, format: "json" }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function findSquadSection(page) {
  const data = await mwApi({ action: "parse", page, redirects: "true", prop: "sections" });
  if (data.error) return { error: data.error.info };
  const sections = data.parse.sections;
  const match = sections.find((s) => SQUAD_SECTION_TITLES.includes(s.line.trim().toLowerCase()));
  return match ? { index: match.index } : { error: "no squad section found" };
}

async function getWikitext(page, sectionIndex) {
  const data = await mwApi({
    action: "parse",
    page,
    redirects: "true",
    section: String(sectionIndex),
    prop: "wikitext",
  });
  if (data.error) return null;
  return data.parse.wikitext["*"];
}

/**
 * Découpe les paramètres d'un template sur "|", mais SEULEMENT en dehors de [[...]] :
 * un lien wiki de la forme [[Article (précision)|Texte affiché]] contient lui-même un "|"
 * qu'il ne faut surtout pas utiliser comme séparateur de champs.
 */
function splitTemplateFields(paramsStr) {
  const fields = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < paramsStr.length; i++) {
    const two = paramsStr.slice(i, i + 2);
    if (two === "[[" || two === "]]") {
      depth += two === "[[" ? 1 : -1;
      current += two;
      i++;
      continue;
    }
    if (paramsStr[i] === "|" && depth === 0) {
      fields.push(current);
      current = "";
      continue;
    }
    current += paramsStr[i];
  }
  fields.push(current);
  return fields;
}

/** Parse {{Fs player|no=X|pos=YY|nat=ZZZ|name=[[Link|Display]]}} template rows, no interpretation. */
function parsePlayers(wikitext) {
  const rows = [...wikitext.matchAll(/\{\{(?:[Ff]s player|football squad player)\|([\s\S]+?)\}\}/g)];
  const players = [];
  for (const row of rows) {
    const fields = Object.fromEntries(
      splitTemplateFields(row[1]).map((f) => {
        const idx = f.indexOf("=");
        return idx === -1 ? [f.trim(), ""] : [f.slice(0, idx).trim(), f.slice(idx + 1).trim()];
      })
    );
    const pos = POSITION_MAP[fields.pos?.toUpperCase()];
    if (!pos || !fields.name) continue;
    // [[Link|Display]] -> Display ; [[Display]] -> Display
    const link = fields.name.match(/\[\[([^\]]+)\]\]/);
    const display = link ? (link[1].includes("|") ? link[1].split("|")[1] : link[1]) : fields.name;
    const cleanName = display.replace(/\(.*\)$/, "").trim(); // drop disambiguation "(footballer, born 2003)"
    if (!cleanName || cleanName.includes("[[") || cleanName.includes("]]")) continue;
    players.push({ name: cleanName, position: pos });
  }
  return players;
}

async function fetchTeamSquad(dbName, wikiPage) {
  const section = await findSquadSection(wikiPage);
  if (section.error) return { team: dbName, wikiPage, error: section.error };

  const wikitext = await getWikitext(wikiPage, section.index);
  if (!wikitext) return { team: dbName, wikiPage, error: "wikitext fetch failed" };

  const players = parsePlayers(wikitext);
  if (players.length === 0) return { team: dbName, wikiPage, error: "no players parsed" };

  return { team: dbName, players };
}

const TEAMS = JSON.parse(process.argv[2]); // [{dbName, wikiPage}]
const outPath = process.argv[3];

const results = [];
const failures = [];

for (const { dbName, wikiPage } of TEAMS) {
  try {
    const result = await fetchTeamSquad(dbName, wikiPage);
    if (result.error) {
      failures.push(result);
      console.log(`FAIL  ${dbName} (${wikiPage}): ${result.error}`);
    } else {
      results.push(result);
      console.log(`OK    ${dbName}: ${result.players.length} players`);
    }
  } catch (err) {
    failures.push({ team: dbName, wikiPage, error: err.message });
    console.log(`ERROR ${dbName} (${wikiPage}): ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 200)); // rester poli avec l'API Wikipédia
}

writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n${results.length} équipes OK, ${failures.length} échecs.`);
if (failures.length) console.log(JSON.stringify(failures, null, 2));
