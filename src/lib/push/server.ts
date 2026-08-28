import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/server";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

/**
 * Envoie une notification push à tous les abonnés autres que `excludeUserId` (l'auteur du
 * message). Supprime au passage les souscriptions expirées/révoquées (404/410) plutôt que de
 * les retenter indéfiniment.
 */
export async function sendPushToOthers(
  excludeUserId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .neq("user_id", excludeUserId);

  if (!subscriptions || subscriptions.length === 0) return;

  const staleIds: number[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
      }
    })
  );

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }
}
