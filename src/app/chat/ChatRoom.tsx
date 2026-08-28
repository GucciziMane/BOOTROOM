"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  sendChatMessage,
  subscribeToPush,
  unsubscribeFromPush,
  toggleReaction,
  type SendChatMessageState,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import { buttonPrimary, input, linkMuted } from "@/lib/ui";
import { formatParisDateTime } from "@/lib/format-date";
import { splitContentByMentions } from "@/lib/chat/mentions";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/** L'API Push attend la clé VAPID en Uint8Array, pas en base64url telle que fournie. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

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

interface Reaction {
  id: number;
  messageId: number;
  userId: string;
  emoji: string;
}

const initialState: SendChatMessageState = { error: null };

export function ChatRoom({
  initialMessages,
  initialReactions,
  profilesById,
  currentUserId,
}: {
  initialMessages: ChatMessage[];
  initialReactions: Array<{ id: number; message_id: number; user_id: string; emoji: string }>;
  profilesById: Record<string, ProfileInfo>;
  currentUserId: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [reactions, setReactions] = useState<Record<number, Reaction>>(() =>
    Object.fromEntries(
      initialReactions.map((r) => [r.id, { id: r.id, messageId: r.message_id, userId: r.user_id, emoji: r.emoji }])
    )
  );
  const [openPickerFor, setOpenPickerFor] = useState<number | null>(null);
  const [state, formAction, isPending] = useActionState(sendChatMessage, initialState);
  const [notifications, setNotifications] = useState({ supported: false, on: false });
  const [messageText, setMessageText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(false);

  const mentionableUsers = Object.entries(profilesById).map(([id, p]) => ({ id, username: p.username }));
  const allUsernames = mentionableUsers.map((u) => u.username);
  const currentUsername = profilesById[currentUserId]?.username;
  const matchingUsers = mentionQuery
    ? mentionableUsers.filter((u) => u.username.toLowerCase().startsWith(mentionQuery.query.toLowerCase()))
    : [];

  function handleMessageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setMessageText(value);

    const cursor = e.target.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf("@");
    if (atIndex === -1 || /\s/.test(uptoCursor.slice(atIndex + 1))) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery({ query: uptoCursor.slice(atIndex + 1), start: atIndex });
  }

  function selectMention(username: string) {
    if (!mentionQuery) return;
    const cursor = inputRef.current?.selectionStart ?? messageText.length;
    const before = messageText.slice(0, mentionQuery.start);
    const after = messageText.slice(cursor);
    const newValue = `${before}@${username} ${after}`;
    setMessageText(newValue);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + username.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    });
  }

  useEffect(() => {
    // Lu après montage (pas en lazy initial state) pour que le rendu serveur et la première
    // passe client restent identiques : ces API n'existent pas côté serveur.
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
    if (!supported) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications({ supported: false, on: false });
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setNotifications({ supported: true, on: !!sub });
      })
      .catch(() => {
        setNotifications({ supported: true, on: false });
      });
  }, []);

  async function toggleNotifications() {
    if (notifications.on) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribeFromPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setNotifications((prev) => ({ ...prev, on: false }));
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

    await subscribeToPush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    setNotifications((prev) => ({ ...prev, on: true }));
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
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_message_reactions" },
          (payload) => {
            const row = payload.new as { id: number; message_id: number; user_id: string; emoji: string };
            setReactions((prev) => ({
              ...prev,
              [row.id]: { id: row.id, messageId: row.message_id, userId: row.user_id, emoji: row.emoji },
            }));
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "chat_message_reactions" },
          (payload) => {
            const row = payload.new as { id: number; message_id: number; user_id: string; emoji: string };
            setReactions((prev) => ({
              ...prev,
              [row.id]: { id: row.id, messageId: row.message_id, userId: row.user_id, emoji: row.emoji },
            }));
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "chat_message_reactions" },
          (payload) => {
            const row = payload.old as { id: number };
            setReactions((prev) => {
              const next = { ...prev };
              delete next[row.id];
              return next;
            });
          }
        )
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
      setMessageText("");
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
          const reactionGroups: Record<string, string[]> = {};
          for (const r of Object.values(reactions)) {
            if (r.messageId !== m.id) continue;
            (reactionGroups[r.emoji] ??= []).push(r.userId);
          }
          const mentionsMe = !isOwn && !!currentUsername && m.content.includes(`@${currentUsername}`);
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
                <p
                  className={`mt-1 inline-block rounded-2xl border px-3 py-2 ${
                    isOwn
                      ? "border-ink bg-ink text-paper"
                      : mentionsMe
                        ? "border-accent bg-cream"
                        : "border-line bg-cream"
                  }`}
                >
                  {splitContentByMentions(m.content, allUsernames).map((part, i) =>
                    part.isMention ? (
                      <span key={i} className={`font-bold ${isOwn ? "text-warn-bg" : ""}`}>
                        {part.text}
                      </span>
                    ) : (
                      <span key={i}>{part.text}</span>
                    )
                  )}
                </p>
                <div className={`relative mt-1 flex flex-wrap items-center gap-1 ${isOwn ? "justify-end" : ""}`}>
                  {Object.entries(reactionGroups).map(([emoji, userIds]) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => toggleReaction(m.id, emoji)}
                      className={`rounded-full border px-1.5 py-0.5 text-xs ${
                        userIds.includes(currentUserId) ? "border-ink bg-cream" : "border-line bg-paper"
                      }`}
                    >
                      {emoji} {userIds.length}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOpenPickerFor(openPickerFor === m.id ? null : m.id)}
                    className="text-xs text-mute"
                  >
                    🙂+
                  </button>
                  {openPickerFor === m.id && (
                    <div
                      className={`absolute top-full z-10 mt-1 flex gap-1 rounded-xl border border-line bg-paper p-1.5 shadow-sm ${isOwn ? "right-0" : "left-0"}`}
                    >
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            toggleReaction(m.id, emoji);
                            setOpenPickerFor(null);
                          }}
                          className="text-lg transition-transform hover:scale-125"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form ref={formRef} action={formAction} className="flex gap-2 border-t border-line p-4">
        <div className="relative flex-1">
          {mentionQuery && matchingUsers.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-48 overflow-y-auto rounded-xl border border-line bg-paper shadow-sm">
              {matchingUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selectMention(u.username)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-cream"
                >
                  @{u.username}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            name="content"
            placeholder="Écris un message... (@ pour mentionner)"
            maxLength={2000}
            required
            autoComplete="off"
            value={messageText}
            onChange={handleMessageChange}
            className={input}
          />
        </div>
        <button type="submit" disabled={isPending} className={buttonPrimary}>
          Envoyer
        </button>
      </form>
      {state.error && <p className="px-4 pb-4 text-sm text-bad">{state.error}</p>}
    </div>
  );
}
