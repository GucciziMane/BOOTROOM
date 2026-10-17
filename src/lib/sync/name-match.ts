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
  praha: "prague", // SK Slavia Praha (football-data) -> Slavia Prague (ESPN)
};

/** Normalise un nom pour comparaison : minuscules, sans accents, sans ponctuation ni suffixes de club. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[øæœßđłı]/g, (c) => SPECIAL_LETTERS[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents (marques diacritiques combinantes après NFD)
    // fk/sk/pae : préfixes/suffixes juridiques d'Europe de l'Est/Grèce vus en Ligue des Champions
    // (ex: "PAE AEK" côté football-data vs "AEK Athens" côté ESPN, "FK Shakhtar Donetsk").
    .replace(/\b(fc|cf|sc|ac|as|rc|ol|om|psg|club|calcio|cd|ud|sd|uc|fk|sk|pae)\b/g, "")
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
 * Retrouve dans une liste de matchs d'une source externe (même compétition, même jour) celui qui
 * correspond au nôtre. Les deux équipes doivent d'abord correspondre (dans un sens ou dans l'autre,
 * Highlightly inverse parfois domicile/extérieur) ; à défaut, et seulement pour un match terminé
 * dont on fournit le score final, on accepte un candidat UNIQUE dont une des deux équipes
 * correspond, au score final identique et au coup d'envoi à moins de 3h du nôtre. Le score est
 * indispensable : le rapprochement de noms tolère des sous-ensembles ("Paris FC" ⊂ "Paris
 * Saint-Germain"), donc une seule équipe reconnue ne suffit pas à elle seule. Sans ce repli, une seule
 * orthographe divergente ("PAE AEK" vs "AEK Athens", vu en prod le 17/10/2026) laissait le match
 * sans buteurs pour toujours, retenté à chaque passage du cron et brûlant le quota Highlightly.
 *
 * `flipped` : vrai si le domicile de la source est NOTRE extérieur — à utiliser avec teamSideOf.
 */
export function findFixture<E>(
  candidates: E[],
  ours: { homeName: string; awayName: string; kickoffAt: string; homeScore?: number | null; awayScore?: number | null },
  get: (e: E) => { home: string; away: string; date?: string | null; homeScore?: number | null; awayScore?: number | null }
): { fixture: E; flipped: boolean } | null {
  const sides = (e: E) => {
    const { home, away } = get(e);
    return {
      straight: teamNamesMatch(home, ours.homeName) || teamNamesMatch(away, ours.awayName),
      straightBoth: teamNamesMatch(home, ours.homeName) && teamNamesMatch(away, ours.awayName),
      flipped: teamNamesMatch(home, ours.awayName) || teamNamesMatch(away, ours.homeName),
      flippedBoth: teamNamesMatch(home, ours.awayName) && teamNamesMatch(away, ours.homeName),
    };
  };

  for (const e of candidates) {
    const s = sides(e);
    if (s.straightBoth) return { fixture: e, flipped: false };
    if (s.flippedBoth) return { fixture: e, flipped: true };
  }

  if (ours.homeScore == null || ours.awayScore == null) return null;
  const ourKickoff = new Date(ours.kickoffAt).getTime();
  const partial = candidates.filter((e) => {
    const s = sides(e);
    // Un seul sens possible, sinon on ne sait pas orienter les buts : on préfère ne rien deviner.
    if (s.straight === s.flipped) return false;
    const { date, homeScore, awayScore } = get(e);
    if (!date || Math.abs(new Date(date).getTime() - ourKickoff) > 3 * 60 * 60 * 1000) return false;
    const [h, a] = s.flipped ? [awayScore, homeScore] : [homeScore, awayScore];
    return h === ours.homeScore && a === ours.awayScore;
  });
  if (partial.length !== 1) return null;
  return { fixture: partial[0], flipped: sides(partial[0]).flipped };
}

/**
 * Côté (domicile/extérieur, de NOTRE point de vue) d'un évènement (but, carton, remplacement) en
 * comparant l'équipe de l'évènement à celles du match DANS LA MÊME SOURCE — même orthographe des
 * deux côtés, donc fiable même quand nos noms divergent de ceux de la source (ce qui, avant,
 * envoyait silencieusement tous les buts de "AEK Athens" à l'équipe adverse, faute de matcher
 * "PAE AEK").
 */
export function teamSideOf(eventTeam: string, source: { home: string; away: string }, flipped: boolean): "home" | "away" {
  const isSourceHome =
    eventTeam === source.home || (eventTeam !== source.away && teamNamesMatch(eventTeam, source.home));
  return isSourceHome !== flipped ? "home" : "away";
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
  "samu aghehowa": "samu omorodion", // FC Porto — ESPN utilise son nom de naissance
  // Joueurs enregistrés sous un seul prénom-surnom : jamais déductible sans risque (un "Isaac" de
  // l'effectif n'est pas "Isaac Romero" de l'équipe adverse), donc listés un par un.
  "vinicius lopes": "vinicius", // CD Santa Clara
  "johnny cardoso": "johnny", // Atlético de Madrid
};

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Replis pour un nom qu'aucune règle principale ne relie (audit du 17/10/2026 : 19 buts/passes
 * perdus pour des variantes d'orthographe d'un joueur pourtant bien dans l'effectif). Appliqués
 * dans l'ordre, du plus sûr au plus permissif, et seulement s'ils désignent un candidat UNIQUE :
 * 1. mêmes lettres une fois les espaces retirés, dans n'importe quel ordre de mots ("Jay Da
 *    Silva"/"Jay Dasilva", "Hwang Hee-Chan"/"Hwang Heechan", "Lee Kang-In"/"Kang-in Lee") ;
 * 2. un nom inclus dans l'autre, mot pour mot, avec au moins deux mots en commun ("Pau Víctor"/
 *    "Pau Victor Delgado") — jamais un prénom seul : vu en simulation, "Isaac Romero" (adversaire)
 *    serait sinon devenu "Isaac" de l'effectif, et "Carlos Augusto" le "Carlos" d'à côté ;
 * 3. même prénom (ou initiale) et nom de famille à une lettre près ("Djoló"/"Djaló",
 *    "De Amorim"/"De Amorin", "Yarmoliuk"/"Yarmolyuk").
 */
function fuzzyFallback<P extends { id: number; name: string }>(tokens: string[], candidates: P[]): P | null {
  const unique = (list: P[]) => (list.length === 1 ? list[0] : null);
  const sortedCompact = (t: string[]) => [...t].sort().join("");
  const targetCompact = sortedCompact(tokens);
  const candTokens = candidates.map((c) => ({ c, t: normalizeName(c.name).split(" ").filter(Boolean) }));

  const byCompact = unique(
    candTokens.filter(({ t }) => sortedCompact(t) === targetCompact || t.join("") === tokens.join("")).map(({ c }) => c)
  );
  if (byCompact) return byCompact;

  const significant = (t: string[]) => t.filter((x) => x.length >= 3);
  const ts = significant(tokens);
  const bySubset = unique(
    candTokens
      .filter(({ t }) => {
        const cs = significant(t);
        if (Math.min(cs.length, ts.length) < 2) return false;
        return cs.every((x) => ts.includes(x)) || ts.every((x) => cs.includes(x));
      })
      .map(({ c }) => c)
  );
  if (bySubset) return bySubset;

  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  return unique(
    candTokens
      .filter(({ t }) => {
        if (t.length < 2) return false;
        const cLast = t[t.length - 1];
        const sameFirst = first.length === 1 || t[0].length === 1 ? t[0][0] === first[0] : editDistance(t[0], first) <= 1;
        return sameFirst && last.length >= 5 && editDistance(cLast, last) <= 1;
      })
      .map(({ c }) => c)
  );
}

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
export function matchPlayerByName<P extends { id: number; name: string; position?: string | null }>(
  targetName: string,
  candidates: P[],
  /** Rôle du joueur côté source (ESPN). Ne sert qu'à départager plusieurs candidats homonymes
   * (deux "Pedrinho" au Shakhtar : un défenseur, un attaquant) — jamais à écarter un candidat unique. */
  roleHint?: "defensive" | "offensive" | null
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
    const retry = byLastToken(tokens[tokens.length - 2]);
    // Ne remplace un résultat ambigu que par un résultat unique : sinon on perdrait les candidats
    // que le départage par prénom ci-dessous sait justement trancher.
    if (retry.length === 1 || matches.length === 0) matches = retry;
  }

  // Coéquipiers au même nom de famille (Nico/Iñaki Williams, Lautaro/Josep Martínez, Pio/Sebastiano
  // Esposito...) : le dernier token seul ne suffit pas — constaté en audit le 17/10/2026, 19 buts/
  // passes jamais reliés à un joueur pour cette seule raison, donc jamais payés. On départage par
  // nom complet identique, sinon par prénom (ou initiale, "L. Martinez"), et seulement si ça
  // désigne un candidat unique.
  if (matches.length > 1) {
    const exact = matches.filter((c) => normalizeName(c.name) === tokens.join(" "));
    if (exact.length === 1) return exact[0];
    const first = tokens[0];
    if (tokens.length >= 2) {
      const byFirst = matches.filter((c) => {
        const candidateFirst = normalizeName(c.name).split(" ")[0];
        return first.length === 1 ? candidateFirst.startsWith(first) : candidateFirst === first;
      });
      if (byFirst.length === 1) return byFirst[0];
    }
  }

  if (matches.length > 1 && roleHint) {
    const isDefensive = (c: P) => c.position === "Goalkeeper" || c.position === "Defender";
    const byRole = matches.filter((c) => c.position != null && isDefensive(c) === (roleHint === "defensive"));
    if (byRole.length === 1) return byRole[0];
  }

  if (matches.length === 0) return fuzzyFallback(tokens, candidates);

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
