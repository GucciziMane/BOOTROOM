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

/**
 * Retrouve, parmi une liste de joueurs (déjà filtrée sur la bonne équipe), celui dont le nom
 * correspond le mieux à un nom donné par API-Football (souvent abrégé, ex: "A. Gouiri").
 * Compare sur le nom de famille (dernier token) pour rester robuste aux abréviations de prénom ;
 * renvoie null si aucune correspondance unique n'est trouvée plutôt que de deviner.
 */
export function matchPlayerByName<P extends { id: number; name: string }>(
  targetName: string,
  candidates: P[]
): P | null {
  const targetLastName = normalizeName(targetName).split(" ").pop();
  if (!targetLastName) return null;

  const matches = candidates.filter((c) => normalizeName(c.name).split(" ").includes(targetLastName));

  return matches.length === 1 ? matches[0] : null;
}
