const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "Boot Room <rappels@bootroom.online>";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY manquante dans les variables d'environnement");
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
    // Sans timeout (contrairement aux 3 autres clients API de l'appli — football-data, Highlightly,
    // ESPN), une réponse Resend qui traîne pouvait à elle seule épuiser tout le budget de temps du
    // cron prediction-reminders sans jamais échouer proprement.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
}
