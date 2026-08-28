"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const STORAGE_KEY = "chat-notifications-enabled";

export function chatNotificationsEnabled(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function setChatNotificationsEnabled(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

/**
 * Écoute les nouveaux messages du chat en tâche de fond et affiche une notification
 * navigateur (Web Notifications API — ne fonctionne que tant qu'un onglet du site est ouvert,
 * pas de push si le navigateur est fermé). Silencieuse tant que l'utilisateur n'a pas activé
 * les notifications via le bouton de ChatRoom, ou s'il regarde déjà /chat.
 */
export function ChatNotifications({ currentUserId }: { currentUserId: string }) {
  const usernamesRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return;
      supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel("chat_notifications")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async (payload) => {
          const row = payload.new as { user_id: string; content: string };
          if (row.user_id === currentUserId) return;
          if (!chatNotificationsEnabled() || Notification.permission !== "granted") return;
          if (window.location.pathname === "/chat" && document.visibilityState === "visible") return;

          if (!usernamesRef.current) {
            const { data } = await supabase.from("profiles").select("id, username");
            usernamesRef.current = new Map((data ?? []).map((p) => [p.id as string, p.username as string]));
          }
          const sender = usernamesRef.current.get(row.user_id) ?? "Quelqu'un";

          const notification = new Notification(`${sender} — 3ème mi-temps`, {
            body: row.content,
            tag: "chat-message",
          });
          notification.onclick = () => {
            window.focus();
            window.location.href = "/chat";
          };
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return null;
}
