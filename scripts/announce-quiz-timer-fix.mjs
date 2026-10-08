// Annonce système dans le chat (message ponctuel, demandé par l'utilisateur) : prévient les
// joueurs que le minuteur du quiz se recale désormais sur l'horloge murale et ne peut plus être
// gelé en passant l'appli en arrière-plan ou en verrouillant l'écran (voir la correction de
// src/app/quiz/QuizRunner.tsx, deadlineRef).
//
// Même mécanisme que les récaps de journée automatiques (src/lib/chat/matchday-recap.ts) :
// message avec user_id=null + is_system=true, posté sous le nom système "Gianni Infantino"
// (src/lib/system-sender.ts), accompagné d'une notification push à tout le monde.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/announce-quiz-timer-fix.mjs
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SYSTEM_SENDER_NAME = "Gianni Infantino";

const content = [
  "🔒 Petite mise à jour sur le quiz du jour",
  "",
  "Le minuteur de 20s se cale désormais sur l'horloge plutôt que sur l'appli ouverte — verrouiller l'écran ne met plus le chrono en pause, il continue de tourner tranquillement pendant ce temps-là.",
  "",
  "Prévenus, pas surpris 😄",
].join("\n");

async function main() {
  const { error } = await supabase.from("chat_messages").insert({ user_id: null, content, is_system: true });
  if (error) throw new Error(`Insertion message: ${error.message}`);
  console.log("Message posté dans le chat.");

  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (!subscriptions || subscriptions.length === 0) {
    console.log("Aucun abonné push, terminé.");
    return;
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({
    title: SYSTEM_SENDER_NAME,
    body: "🔒 Petite mise à jour sur le minuteur du quiz du jour",
    url: "/chat",
  });

  const staleIds = [];
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
      }
    })
  );
  if (staleIds.length > 0) await supabase.from("push_subscriptions").delete().in("id", staleIds);

  console.log(`Push envoyé à ${subscriptions.length - staleIds.length} abonné(s) (${staleIds.length} expiré(s) nettoyé(s)).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
