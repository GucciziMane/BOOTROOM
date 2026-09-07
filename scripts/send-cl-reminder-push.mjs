// Notif ponctuelle demandée par l'utilisateur pour annoncer l'arrivée de la Ligue des Champions
// et inviter tout le monde à pronostiquer avant le coup d'envoi de la journée 1.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

async function main() {
  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (!subscriptions || subscriptions.length === 0) {
    console.log("Aucun abonné push.");
    return;
  }

  const payload = JSON.stringify({
    title: "Gianni Infantino",
    body: "⭐ La Ligue des Champions est arrivée ! Va pronostiquer avant le coup d'envoi de la journée 1 (demain 18h45).",
    url: "/leagues/CL/calendar",
  });

  const staleIds = [];
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) staleIds.push(sub.id);
        else console.error(`Échec envoi vers subscription ${sub.id}:`, err.statusCode, err.body);
      }
    })
  );

  if (staleIds.length > 0) await supabase.from("push_subscriptions").delete().in("id", staleIds);
  console.log(`Envoyé à ${subscriptions.length - staleIds.length}/${subscriptions.length} abonnés (${staleIds.length} expirés nettoyés).`);
}

main();
