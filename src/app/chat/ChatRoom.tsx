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
import { FavoriteTeamBadge } from "@/app/profile/FavoriteTeamBadge";
import { formatParisDateTime } from "@/lib/format-date";
import { splitContentByMentions } from "@/lib/chat/mentions";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

// Les notifications sont activées par défaut pour tout le monde (voir toggleNotifications) : on
// ne mémorise localement que le fait qu'un utilisateur les a désactivées à la main, pour ne pas
// re-proposer/re-souscrire à chaque visite après un refus explicite.
const OPT_OUT_KEY = "chat-notifications-opted-out";

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
  imageUrl: string | null;
  createdAt: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ProfileInfo {
  username: string;
  avatarUrl: string | null;
  favoriteTeamLogoUrl: string | null;
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(false);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image trop lourde (5 Mo max).");
      e.target.value = "";
      return;
    }
    setImageError(null);
    setImageFile(file);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function clearImage() {
    setImageFile(null);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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

  async function subscribe() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

    await subscribeToPush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    return true;
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
      .then(async (sub) => {
        if (sub) {
          setNotifications({ supported: true, on: true });
          return;
        }

        // Activées par défaut : si personne n'a explicitement désactivé les notifications sur cet
        // appareil et que le navigateur n'a pas déjà refusé la permission, on souscrit directement
        // au lieu d'attendre un clic manuel.
        let optedOut = false;
        try {
          optedOut = localStorage.getItem(OPT_OUT_KEY) === "1";
        } catch {
          // Stockage indisponible (navigation privée, etc.) : on se comporte comme si personne
          // n'avait rien désactivé.
        }
        if (optedOut || typeof Notification === "undefined" || Notification.permission === "denied") {
          setNotifications({ supported: true, on: false });
          return;
        }

        const subscribed = await subscribe().catch(() => false);
        setNotifications({ supported: true, on: subscribed });
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
      try {
        localStorage.setItem(OPT_OUT_KEY, "1");
      } catch {
        // Stockage indisponible : tant pis, l'utilisateur devra redésactiver manuellement au besoin.
      }
      setNotifications((prev) => ({ ...prev, on: false }));
      return;
    }

    const subscribed = await subscribe();
    if (!subscribed) return;
    try {
      localStorage.removeItem(OPT_OUT_KEY);
    } catch {
      // Stockage indisponible : sans conséquence, il n'y avait rien à effacer côté serveur.
    }
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
          const row = payload.new as {
            id: number;
            user_id: string;
            content: string;
            image_url: string | null;
            created_at: string;
          };
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: row.id,
                    userId: row.user_id,
                    content: row.content,
                    imageUrl: row.image_url,
                    createdAt: row.created_at,
                  },
                ]
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
      clearImage();
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {notifications.supported && (
        <div className="flex justify-end px-4 pt-3">
          <button
            type="button"
            onClick={toggleNotifications}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              notifications.on ? "bg-accent-soft text-accent-hover" : `bg-paper text-mute shadow-sm hover:text-ink`
            }`}
          >
            {notifications.on ? "🔔 Notifications activées" : "🔕 Activer les notifications"}
          </button>
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => {
          const profile = profilesById[m.userId];
          const isOwn = m.userId === currentUserId;
          const reactionGroups: Record<string, string[]> = {};
          for (const r of Object.values(reactions)) {
            if (r.messageId !== m.id) continue;
            (reactionGroups[r.emoji] ??= []).push(r.userId);
          }
          const hasReactions = Object.keys(reactionGroups).length > 0;
          const mentionsMe = !isOwn && !!currentUsername && m.content.includes(`@${currentUsername}`);
          return (
            <div key={m.id} className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
              {!isOwn && (
                <span className="relative h-7 w-7 shrink-0">
                  <span className="relative block h-7 w-7 overflow-hidden rounded-full bg-cream">
                    {profile?.avatarUrl ? (
                      <Image src={profile.avatarUrl} alt="" fill sizes="28px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs font-bold text-mute">
                        {(profile?.username ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <FavoriteTeamBadge logoUrl={profile?.favoriteTeamLogoUrl ?? null} size={13} />
                </span>
              )}
              <div className={`flex max-w-[75%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
                {!isOwn && (
                  <p className="mb-1 px-1 text-[11px] font-bold text-mute">{profile?.username ?? "?"}</p>
                )}
                {m.imageUrl && (
                  <a
                    href={m.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block overflow-hidden rounded-2xl ${m.content ? "mb-1" : ""} ${isOwn ? "rounded-br-md" : "rounded-bl-md"}`}
                  >
                    <Image
                      src={m.imageUrl}
                      alt=""
                      width={280}
                      height={280}
                      sizes="280px"
                      className="h-auto max-h-72 w-full max-w-[240px] object-cover"
                    />
                  </a>
                )}
                {m.content && (
                  <div
                    className={`px-3.5 py-2 text-[15px] leading-snug ${
                      isOwn
                        ? "rounded-2xl rounded-br-md bg-accent text-paper"
                        : mentionsMe
                          ? "rounded-2xl rounded-bl-md bg-accent-soft text-ink ring-1 ring-inset ring-accent"
                          : "rounded-2xl rounded-bl-md bg-paper text-ink shadow-sm"
                    }`}
                  >
                    {splitContentByMentions(m.content, allUsernames).map((part, i) =>
                      part.isMention ? (
                        <span key={i} className={`font-bold ${isOwn ? "text-warn-bg" : "text-accent-hover"}`}>
                          {part.text}
                        </span>
                      ) : (
                        <span key={i}>{part.text}</span>
                      )
                    )}
                  </div>
                )}
                <div className="relative mt-1 flex items-center gap-1.5 px-1">
                  <p className="text-[10px] text-mute">{formatParisDateTime(m.createdAt)}</p>
                  <button
                    type="button"
                    onClick={() => setOpenPickerFor(openPickerFor === m.id ? null : m.id)}
                    className="text-[11px] text-mute transition-colors hover:text-ink"
                    aria-label="Ajouter une réaction"
                  >
                    🙂+
                  </button>
                  {openPickerFor === m.id && (
                    <div
                      className={`absolute bottom-full z-10 mb-1 flex gap-1 rounded-xl bg-paper p-1.5 shadow-md ${isOwn ? "right-0" : "left-0"}`}
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
                {hasReactions && (
                  <div className={`-mt-1 flex flex-wrap gap-1 px-1 ${isOwn ? "justify-end" : "justify-start"}`}>
                    {Object.entries(reactionGroups).map(([emoji, userIds]) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(m.id, emoji)}
                        className={`rounded-full px-1.5 py-0.5 text-xs shadow-sm transition-colors ${
                          userIds.includes(currentUserId) ? "bg-accent-soft text-accent-hover" : "bg-paper text-ink"
                        }`}
                      >
                        {emoji} {userIds.length}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {imageError && <p className="px-5 pb-1 text-xs text-bad">{imageError}</p>}
      {imagePreviewUrl && (
        <div className="px-4 pb-2">
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL local, non compatible avec le loader next/image */}
            <img src={imagePreviewUrl} alt="" className="h-20 w-20 rounded-xl object-cover shadow-sm" />
            <button
              type="button"
              onClick={clearImage}
              aria-label="Retirer l'image"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-paper shadow-sm"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <form ref={formRef} action={formAction} className="flex items-center gap-2 p-4 pt-2">
        <input
          ref={fileInputRef}
          type="file"
          name="image"
          accept="image/*"
          onChange={handleImageChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Ajouter une photo"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-mute shadow-sm transition-colors hover:text-ink"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="15" rx="2.5" />
            <circle cx="9" cy="11" r="2.2" />
            <path d="M3 17l5-5 3.5 3.5L16 11l5 5" />
          </svg>
        </button>
        <div className="relative flex-1">
          {mentionQuery && matchingUsers.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-48 overflow-y-auto rounded-xl border border-line bg-paper shadow-md">
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
            autoComplete="off"
            value={messageText}
            onChange={handleMessageChange}
            className="w-full rounded-full border border-line bg-paper px-4 py-2.5 text-ink shadow-sm placeholder:text-mute focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isPending || (!messageText.trim() && !imageFile)}
          aria-label="Envoyer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-paper transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      {state.error && <p className="px-4 pb-4 text-sm text-bad">{state.error}</p>}
    </div>
  );
}
