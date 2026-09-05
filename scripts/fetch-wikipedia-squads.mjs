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
    // Le titre de la page (avant le "|") sert à retrouver la photo de la fiche joueur ensuite ;
    // sans lien wiki (nom en texte brut, joueur trop obscur pour avoir un article), pas de photo possible.
    const wikiTitle = link ? link[1].split("|")[0].trim() : null;
    players.push({ name: cleanName, position: pos, wikiTitle });
  }
  return players;
}

/**
 * Résout les photos de joueurs via l'API "pageimages" de Wikipédia (l'image d'infobox que
 * Wikipédia associe déjà à chaque article) plutôt que via Wikidata : pour une personne vivante,
 * les règles de contenu non-libre de Wikipédia (WP:NFCC) interdisent une photo "fair use" dès
 * qu'une photo libre est possible, donc la quasi-totalité des portraits de footballeurs en
 * activité sur Wikipédia sont déjà des photos Commons sous licence libre — cette API renvoie
 * directement l'URL utilisable, sans étape Wikidata en plus.
 */
async function fetchPhotos(wikiTitles) {
  const photoByTitle = new Map();
  const titles = [...new Set(wikiTitles)];
  const BATCH = 50; // limite de l'API MediaWiki pour "titles" en anonyme

  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    try {
      const data = await mwApi({
        action: "query",
        titles: batch.join("|"),
        prop: "pageimages",
        piprop: "original",
        redirects: "1",
      });
      const pages = data.query?.pages ?? {};
      // "redirects"/"normalized" font correspondre le titre demandé (ex: lien wiki avec espaces
      // insécables ou variante de casse) au titre final de la page réellement retournée.
      const canonicalByRequested = new Map();
      for (const r of data.query?.redirects ?? []) canonicalByRequested.set(r.from, r.to);
      for (const n of data.query?.normalized ?? []) canonicalByRequested.set(n.from, n.to);

      const imageByCanonical = new Map();
      for (const page of Object.values(pages)) {
        if (page.original?.source) imageByCanonical.set(page.title, page.original.source);
      }
      for (const requested of batch) {
        let canonical = requested;
        // Une page peut être normalisée PUIS redirigée : suivre la chaîne au besoin.
        while (canonicalByRequested.has(canonical)) canonical = canonicalByRequested.get(canonical);
        const url = imageByCanonical.get(canonical);
        if (url) photoByTitle.set(requested, url);
      }
    } catch {
      // Panne ponctuelle de l'API : ce lot de joueurs restera simplement sans photo, pas bloquant.
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return photoByTitle;
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

const allWikiTitles = results.flatMap((r) => r.players.map((p) => p.wikiTitle).filter(Boolean));
console.log(`\nRésolution des photos pour ${allWikiTitles.length} joueurs (avec fiche Wikipédia)...`);
const photoByTitle = await fetchPhotos(allWikiTitles);
for (const r of results) {
  for (const p of r.players) {
    p.photoUrl = p.wikiTitle ? (photoByTitle.get(p.wikiTitle) ?? null) : null;
  }
}
const withPhoto = results.reduce((sum, r) => sum + r.players.filter((p) => p.photoUrl).length, 0);
const totalPlayers = results.reduce((sum, r) => sum + r.players.length, 0);
console.log(`${withPhoto}/${totalPlayers} joueurs avec une photo trouvée.`);

writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n${results.length} équipes OK, ${failures.length} échecs.`);
if (failures.length) console.log(JSON.stringify(failures, null, 2));
