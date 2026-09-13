export interface MentionableUser {
  id: string;
  username: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Résout les "@pseudo" d'un message vers les id des utilisateurs mentionnés.
 *
 * Même regex à frontière de mot (`\b`) que splitContentByMentions — pas un simple
 * `content.includes("@"+username)` : un pseudo préfixe d'un autre (ex: "Tom" dans "@Tom_92")
 * matchait AUSSI comme sous-chaîne de la mention plus longue, notifiant "Tom" à tort pour un
 * message qui ne mentionnait que "Tom_92". Le tri "plus long d'abord" documenté ici avant ne
 * protégeait en rien contre ça : chaque utilisateur était testé indépendamment dans la boucle,
 * rien n'empêchait un préfixe de matcher en plus de la mention complète. */
export function extractMentionedUserIds(content: string, users: MentionableUser[]): string[] {
  const known = users.filter((u) => u.username);
  if (known.length === 0) return [];

  const sorted = [...known].sort((a, b) => b.username.length - a.username.length);
  const pattern = new RegExp(`@(${sorted.map((u) => escapeRegExp(u.username)).join("|")})\\b`, "g");
  const idByUsername = new Map(sorted.map((u) => [u.username, u.id]));

  const mentioned = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    const id = idByUsername.get(match[1]);
    if (id) mentioned.add(id);
  }
  return [...mentioned];
}

/** Découpe un message en segments texte/mention, pour la mise en forme des "@pseudo" à l'affichage. */
export function splitContentByMentions(
  content: string,
  usernames: string[]
): Array<{ text: string; isMention: boolean }> {
  const known = usernames.filter(Boolean);
  if (known.length === 0) return [{ text: content, isMention: false }];

  const sorted = [...known].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(?:${escaped.join("|")})\\b`, "g");

  const parts: Array<{ text: string; isMention: boolean }> = [];
  let lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: content.slice(lastIndex, index), isMention: false });
    parts.push({ text: match[0], isMention: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) parts.push({ text: content.slice(lastIndex), isMention: false });
  return parts;
}
