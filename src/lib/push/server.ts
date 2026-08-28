import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/server";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

type PushSubscriptionRow = { id: number; endpoint: string; p256dh: string; auth: string };

/**
 * Envoie une notification push à un lot de souscriptions. Supprime au passage celles
 * expirées/révoquées (404/410) plutôt que de les retenter indéfiniment.
 */
async function sendToSubscriptions(
  subscriptions: PushSubscriptionRow[],
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (subscriptions.length === 0) return;

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
    const supabase = createServiceRoleClient();
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }
}

/** Notification push à tous les abonnés sauf ceux listés dans `excludeUserIds` (l'auteur, et les mentionnés le cas échéant). */
export async function sendPushToOthers(
  excludeUserIds: string[],
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth");

  const excludeSet = new Set(excludeUserIds);
  const targets = (subscriptions ?? []).filter((s) => !excludeSet.has(s.user_id));
  await sendToSubscriptions(targets, payload);
}

/** Notification push ciblée à des utilisateurs précis (ex: mention @pseudo). */
export async function sendPushToUserIds(
  userIds: string[],
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (userIds.length === 0) return;
  const supabase = createServiceRoleClient();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  await sendToSubscriptions(subscriptions ?? [], payload);
}
