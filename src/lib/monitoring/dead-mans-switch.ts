/**
 * "Dead man's switch" (healthchecks.io) : indépendant de QStash par construction — l'incident du
 * 19/09/2026 (live-tick silencieux ~2h, scores figés) n'a été remarqué qu'au refresh manuel d'un
 * joueur, parce que TOUTE notre chaîne d'alerte (checkEspnHealthAndAlert dans live-tick) suppose
 * que live-tick tourne encore pour la déclencher — inutile si c'est justement lui qui s'est tu.
 * healthchecks.io fait l'inverse : c'est LUI qui détecte notre silence et alerte, pas nous qui
 * détectons le sien.
 *
 * HEALTHCHECKS_PING_URL absente (pas encore configurée, ou en local) : no-op silencieux, jamais
 * une raison de faire échouer le cron qui l'appelle.
 */
export async function pingDeadMansSwitch(status: "success" | "fail"): Promise<void> {
  const baseUrl = process.env.HEALTHCHECKS_PING_URL;
  if (!baseUrl) return;

  const url = status === "success" ? baseUrl : `${baseUrl}/fail`;
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(5_000) });
  } catch {
    // Un ping raté ne doit jamais faire échouer le cron réel qui l'envoie — healthchecks.io
    // détectera l'absence de ping suivant de toute façon, c'est tout l'intérêt du mécanisme.
  }
}
