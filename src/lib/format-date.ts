/** Formate une date en heure de Paris, quel que soit le fuseau du serveur (ex: Vercel tourne en UTC). */
export function formatParisDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
