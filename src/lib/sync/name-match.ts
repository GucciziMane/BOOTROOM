// Lettres latines qui ne se décomposent pas via NFD (donc pas couvertes par le strip d'accents).
const SPECIAL_LETTERS: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  đ: "d",
  ł: "l",
  ı: "i",
};

// Formes courtes/anglicisées qu'utilise parfois Highlightly et qui ne partagent aucun token avec
// le nom complet côté football-data.org (donc ni sous-ensemble, ni sigle) : trouvées en comparant
// systématiquement les deux sources sur les 5 championnats (ex: Highlightly dit "Rennes FC",
// nous avons "Stade Rennais FC 1901" — aucun mot en commun sans cet alias).
const TOKEN_ALIASES: Record<string, string> = {
  rennes: "rennais", // Rennes FC -> Stade Rennais
  lyon: "lyonnais", // Lyon -> Olympique Lyonnais
  munich: "munchen", // Bayern Munich -> Bayern München (accent déjà retiré par ce point-là)
  estac: "es", // Estac Troyes -> ES Troyes AC
};

/** Normalise un nom pour comparaison : minuscules, sans accents, sans ponctuation ni suffixes de club. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[øæœßđłı]/g, (c) => SPECIAL_LETTERS[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents (marques diacritiques combinantes après NFD)
    .replace(/\b(fc|cf|sc|ac|as|rc|ol|om|psg|club|calcio|cd|ud|sd|uc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ") // ponctuation (tirets, apostrophes...) -> espace, pour séparer les mots composés
    .trim()
    .split(" ")
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .join(" ");
}

// Mots de liaison ignorés pour la comparaison de sous-ensemble, mais conservés dans le nom
// normalisé (ex: "clube") car ils peuvent contribuer à un sigle ("Sporting Clube de Portugal" -> "cp").
const CONNECTORS = new Set(["de", "del", "des", "la", "le", "les", "el", "of", "the"]);

/**
 * Vrai si deux noms d'équipe désignent probablement le même club, en tolérant les mots de
 * liaison qui diffèrent entre sources (ex: "Real Racing Club de Santander" / "Racing Santander")
 * et les sigles (ex: "Sporting Clube de Portugal" / "Sporting CP" — "cp" == initiales de ce qui
 * reste une fois le préfixe commun "sporting" retiré et "de" ignoré).
 */
export function teamNamesMatch(a: string, b: string): boolean {
  const ta = normalizeName(a).split(" ").filter(Boolean);
  const tb = normalizeName(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(" ") === tb.join(" ")) return true;

  const fa = ta.filter((t) => !CONNECTORS.has(t));
  const fb = tb.filter((t) => !CONNECTORS.has(t));
  const [shortTokens, longTokens] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (shortTokens.length > 0 && shortTokens.every((t) => longTokens.includes(t))) return true;

  const common = shortTokens.filter((t) => longTokens.includes(t));
  const shortRest = shortTokens.filter((t) => !common.includes(t));
  const longRest = longTokens.filter((t) => !common.includes(t));
  if (shortRest.length === 1 && shortRest[0].length >= 2 && shortRest[0].length <= 5 && longRest.length >= 2) {
    const initials = longRest.map((w) => w[0]).join("");
    if (initials === shortRest[0]) return true;
  }
  return false;
}

// Certains joueurs (surtout brésiliens/lusophones) sont connus sous un diminutif qui ne partage
// aucun token avec leur nom légal complet — ESPN renvoie parfois ce nom légal complet au lieu du
// nom d'usage habituel pour un même but (vu en prod le 16/09/2026 : "Raphael Dias Belloli" au lieu
// de "Raphinha", but non compté pour aucun pronostic buteur). Ni le dernier ni l'avant-dernier
// token de "Raphael Dias Belloli" ne recoupent "Raphinha" — aucune règle générique de troncature
// de patronyme ne peut couvrir ce cas, répertorié ici au fil des cas rencontrés, comme
// TOKEN_ALIASES pour les noms d'équipe. Clé et valeur : formes déjà normalisées (voir normalizeName).
const FULL_NAME_NICKNAME_ALIASES: Record<string, string> = {
  "raphael dias belloli": "raphinha",
};

/**
 * Retrouve, parmi une liste de joueurs (déjà filtrée sur la bonne équipe), celui dont le nom
 * correspond le mieux à un nom donné par une source externe (souvent abrégé, ex: "A. Gouiri", ou
 * parfois au contraire le nom légal complet, ex: "Daniel Olmo Carvajal" pour "Dani Olmo").
 * Compare sur le nom de famille du candidat (dernier token) pour rester robuste aux abréviations
 * de prénom ; renvoie null si aucune correspondance unique n'est trouvée plutôt que de deviner.
 *
 * Comparaison sur le DERNIER token du candidat uniquement (pas "un token quelconque du nom
 * contient ça") : bug vu en prod — sur un effectif avec "João Pedro" et "Pedro Neto", chercher
 * "pedro" (nom de famille de "João Pedro") en acceptant n'importe quel token candidat matchait
 * AUSSI "Pedro Neto" (prénom "Pedro"), rendait la recherche ambiguë entre les deux, et le but de
 * João Pedro finissait avec player_id=null — jamais compté pour un pronostic buteur.
 */
export function matchPlayerByName<P extends { id: number; name: string }>(
  targetName: string,
  candidates: P[]
): P | null {
  const normalizedTarget = normalizeName(targetName);
  const tokens = (FULL_NAME_NICKNAME_ALIASES[normalizedTarget] ?? normalizedTarget).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const byLastToken = (token: string) => candidates.filter((c) => normalizeName(c.name).split(" ").pop() === token);

  let matches = byLastToken(tokens[tokens.length - 1]);
  // Nom légal à double patronyme (courant en ibéro/lusophone), ex: "Daniel Olmo Carvajal" côté
  // source externe pour un effectif qui ne connaît le joueur que sous son premier patronyme
  // ("Dani Olmo") — le dernier token seul ("carvajal") ne suffit alors plus. Retente avec
  // l'avant-dernier avant d'abandonner ; ne compare toujours que le DERNIER token du CANDIDAT
  // (même garde-fou que ci-dessus), donc aucun nouveau risque d'ambiguïté introduit — un token de
  // liaison ("de", "la"...) ne matchera simplement jamais aucun candidat.
  if (matches.length !== 1 && tokens.length >= 3) {
    matches = byLastToken(tokens[tokens.length - 2]);
  }

  return matches.length === 1 ? matches[0] : null;
}

/**
 * Clé de dédup/rapprochement d'un but entre deux passages (insertion, réconciliation des buts
 * annulés) : par id de joueur quand résolu, sinon par nom brut de la source — un but contre son
 * camp ou marqué par un joueur pas encore synchronisé (transfert récent) n'a pas d'id, mais reste
 * comparable d'un tick à l'autre par son nom tel que fourni par la source. Partagé entre live-tick
 * et sync-fixtures, qui écrivent tous les deux dans match_goals.
 */
export function goalKey(playerId: number | null, rawName: string | null, minute: number | null): string {
  return playerId != null ? `id:${playerId}:${minute}` : `name:${rawName}:${minute}`;
}
