"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { sendChatMessage, type SendChatMessageState } from "./actions";
import { chatNotificationsEnabled, setChatNotificationsEnabled } from "./ChatNotifications";
import { createClient } from "@/lib/supabase/client";
import { buttonPrimary, input, linkMuted } from "@/lib/ui";
import { formatParisDateTime } from "@/lib/format-date";

interface ChatMessage {
  id: number;
  userId: string;
  content: string;
  createdAt: string;
}

interface ProfileInfo {
  username: string;
  avatarUrl: string | null;
}

const initialState: SendChatMessageState = { error: null };

export function ChatRoom({
  initialMessages,
  profilesById,
  currentUserId,
}: {
  initialMessages: ChatMessage[];
  profilesById: Record<string, ProfileInfo>;
  currentUserId: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [state, formAction, isPending] = useActionState(sendChatMessage, initialState);
  const [notifications, setNotifications] = useState({ supported: false, on: false });
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    // Lu après montage (pas en lazy initial state) pour que le rendu serveur et la première
    // passe client restent identiques : Notification.permission n'existe pas côté serveur.
    const supported = typeof window !== "undefined" && "Notification" in window;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifications({
      supported,
      on: supported && Notification.permission === "granted" && chatNotificationsEnabled(),
    });
  }, []);

  async function toggleNotifications() {
    if (notifications.on) {
      setChatNotificationsEnabled(false);
      setNotifications((prev) => ({ ...prev, on: false }));
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setChatNotificationsEnabled(true);
      setNotifications((prev) => ({ ...prev, on: true }));
    }
  }

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // La session (cookies SSR) doit être hydratée dans le client avant de souscrire,
    // sinon le socket Realtime s'ouvre sans JWT et les policies RLS "authenticated" le filtrent.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel("chat_messages_changes")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
          const row = payload.new as { id: number; user_id: string; content: string; created_at: string };
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, { id: row.id, userId: row.user_id, content: row.content, createdAt: row.created_at }]
          );
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      formRef.current?.reset();
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {notifications.supported && (
        <div className="flex justify-end border-b border-line px-4 py-2">
          <button type="button" onClick={toggleNotifications} className={`text-xs ${linkMuted}`}>
            {notifications.on ? "🔔 Notifications activées" : "🔕 Activer les notifications"}
          </button>
        </div>
      )}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) => {
          const profile = profilesById[m.userId];
          const isOwn = m.userId === currentUserId;
          return (
            <div key={m.id} className={`flex items-start gap-3 ${isOwn ? "flex-row-reverse text-right" : ""}`}>
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-line bg-cream">
                {profile?.avatarUrl ? (
                  <Image src={profile.avatarUrl} alt="" fill sizes="32px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs font-bold text-mute">
                    {(profile?.username ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <div>
                <p className="text-xs font-bold text-mute">
                  {profile?.username ?? "?"} · {formatParisDateTime(m.createdAt)}
                </p>
                <p className="mt-1 inline-block rounded-2xl border border-line bg-cream px-3 py-2">{m.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form ref={formRef} action={formAction} className="flex gap-2 border-t border-line p-4">
        <input type="text" name="content" placeholder="Écris un message..." maxLength={2000} required className={input} />
        <button type="submit" disabled={isPending} className={buttonPrimary}>
          Envoyer
        </button>
      </form>
      {state.error && <p className="px-4 pb-4 text-sm text-bad">{state.error}</p>}
    </div>
  );
}
