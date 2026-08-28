export interface MentionableUser {
  id: string;
  username: string;
}

/**
 * Usernames triés du plus long au plus court pour qu'un pseudo préfixe d'un autre (ex: "Ti"
 * dans "Ti_to") ne soit jamais retenu à sa place d'une mention plus longue.
 */
function byLongestUsernameFirst(users: MentionableUser[]): MentionableUser[] {
  return [...users].sort((a, b) => b.username.length - a.username.length);
}

/** Résout les "@pseudo" d'un message vers les id des utilisateurs mentionnés. */
export function extractMentionedUserIds(content: string, users: MentionableUser[]): string[] {
  const mentioned = new Set<string>();
  for (const u of byLongestUsernameFirst(users)) {
    if (u.username && content.includes(`@${u.username}`)) mentioned.add(u.id);
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
