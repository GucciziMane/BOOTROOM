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

/** Normalise un nom pour comparaison : minuscules, sans accents, sans ponctuation ni suffixes de club. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[øæœßđłı]/g, (c) => SPECIAL_LETTERS[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents (marques diacritiques combinantes après NFD)
    .replace(/\b(fc|cf|sc|ac|as|rc|ol|om|psg|club|calcio|cd|ud|sd|uc)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Vrai si deux noms d'équipe désignent probablement le même club (contenance après normalisation). */
export function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
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

  const matches = candidates.filter((c) => {
    const candidateTokens = normalizeName(c.name).split(" ");
    return candidateTokens.includes(targetLastName) || candidateTokens.pop() === targetLastName;
  });

  return matches.length === 1 ? matches[0] : null;
}
