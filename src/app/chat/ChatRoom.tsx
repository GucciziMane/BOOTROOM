"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  sendChatMessage,
  subscribeToPush,
  unsubscribeFromPush,
  toggleReaction,
  markPhotoViewed,
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
  isEphemeral: boolean;
  createdAt: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Le flash ("torch") n'est pas dans les types DOM standard : capacité expérimentale, supportée
// seulement sur certains Chrome Android (jamais sur iOS Safari, limitation de la plateforme).
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}
interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

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
  initialViewedMessageIds,
  profilesById,
  currentUserId,
}: {
  initialMessages: ChatMessage[];
  initialReactions: Array<{ id: number; message_id: number; user_id: string; emoji: string }>;
  initialViewedMessageIds: number[];
  profilesById: Record<string, ProfileInfo>;
  currentUserId: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [reactions, setReactions] = useState<Record<number, Reaction>>(() =>
    Object.fromEntries(
      initialReactions.map((r) => [r.id, { id: r.id, messageId: r.message_id, userId: r.user_id, emoji: r.emoji }])
    )
  );
  const [viewedIds, setViewedIds] = useState<Set<number>>(() => new Set(initialViewedMessageIds));
  const [openedPhoto, setOpenedPhoto] = useState<ChatMessage | null>(null);
  const [openPickerFor, setOpenPickerFor] = useState<number | null>(null);
  const [state, formAction, isPending] = useActionState(sendChatMessage, initialState);
  const [notifications, setNotifications] = useState({ supported: false, on: false });
  const [messageText, setMessageText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isEphemeralPick, setIsEphemeralPick] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isFirstScroll = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const formImageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const wasPending = useRef(false);

  // Caméra filmée en direct dans la page (au lieu de déléguer à l'appli photo native du
  // téléphone) : certains navigateurs mobiles ignorent capture="environment" ou renvoient une
  // photo mirroir/pivotée selon le mode utilisé — ici on choisit nous-mêmes quelle caméra ouvrir
  // (avant/arrière) et on maîtrise la capture. La caméra avant est mirée à l'écran (usage normal,
  // comme un miroir) mais la photo enregistrée est dé-mirée pour rester lisible, contrairement au
  // souci d'origine.
  function stopCameraStream() {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
  }

  async function startStream(mode: "environment" | "user") {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: mode } },
      audio: false,
    });
    cameraStreamRef.current = stream;
    // Nécessaire ici en plus de l'effet ci-dessous : lors d'un changement de caméra, la <video>
    // est déjà montée et cameraOpen ne change pas, donc l'effet keyé sur [cameraOpen] ne se
    // redéclenche pas — sans cette ligne l'écran reste noir sur le flux (arrêté) précédent.
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    setFacingMode(mode);
    const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as TorchCapabilities | undefined;
    setTorchSupported(!!caps?.torch);
    setTorchOn(false);
  }

  async function openCamera() {
    try {
      await startStream("environment");
      setCameraOpen(true);
    } catch {
      // Caméra live indisponible (permission refusée, API non supportée...) : on retombe sur le
      // sélecteur caméra natif du téléphone plutôt que de bloquer l'envoi de photo.
      cameraInputRef.current?.click();
    }
  }

  async function switchCamera() {
    const previous = facingMode;
    const next = previous === "environment" ? "user" : "environment";
    stopCameraStream();
    try {
      await startStream(next);
    } catch {
      // Bascule impossible (une seule caméra dispo, permission...) : on retente l'ancienne pour
      // ne pas rester sans flux, et on ferme si même ça échoue.
      await startStream(previous).catch(closeCamera);
    }
  }

  async function toggleTorch() {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as TorchConstraintSet] });
      setTorchOn((v) => !v);
    } catch {
      // Contrainte "torch" refusée malgré la capacité annoncée : rien à faire, le bouton reste
      // visible mais sans effet plutôt que de planter la capture.
    }
  }

  function closeCamera() {
    stopCameraStream();
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (facingMode === "user") {
      // La caméra avant est affichée mirée (naturel, comme un miroir) mais on dé-mire la capture
      // pour que le texte/l'orientation restent lisibles sur la photo envoyée.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        processSelectedFile(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }), true);
        closeCamera();
      },
      "image/jpeg",
      0.9
    );
  }

  useEffect(() => {
    if (cameraOpen && videoRef.current) videoRef.current.srcObject = cameraStreamRef.current;
  }, [cameraOpen]);

  useEffect(() => stopCameraStream, []);

  function processSelectedFile(file: File, ephemeral: boolean) {
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image trop lourde (5 Mo max).");
      return;
    }
    setImageError(null);
    setImageFile(file);
    setIsEphemeralPick(ephemeral);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    // Les deux boutons (caméra / pellicule) sont des inputs "jetables" hors formulaire : le
    // fichier retenu est transplanté dans ce champ caché `name="image"`, seul lu à l'envoi.
    if (formImageInputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      formImageInputRef.current.files = dt.files;
    }
  }

  function handleCameraChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processSelectedFile(file, true);
  }

  function handleGalleryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processSelectedFile(file, false);
  }

  function clearImage() {
    setImageFile(null);
    setIsEphemeralPick(false);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageError(null);
    if (formImageInputRef.current) formImageInputRef.current.value = "";
  }

  async function openEphemeralPhoto(m: ChatMessage) {
    setOpenedPhoto(m);
    if (!viewedIds.has(m.id)) {
      setViewedIds((prev) => new Set(prev).add(m.id));
      await markPhotoViewed(m.id);
    }
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
            is_ephemeral: boolean;
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
                    isEphemeral: row.is_ephemeral,
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
    // "auto" (instant) à l'ouverture : un défilement "smooth" qui démarre avant que les avatars/
    // photos aient fini de charger peut s'arrêter avant le vrai bas, qui recule encore pendant
    // l'animation. Les arrivées de nouveaux messages ensuite restent en smooth (plus agréable).
    bottomRef.current?.scrollIntoView({ behavior: isFirstScroll.current ? "auto" : "smooth" });
    isFirstScroll.current = false;
  }, [messages.length]);

  useEffect(() => {
    // Recale en bas si une image (avatar, photo) finit de charger après coup et grandit le
    // contenu — mais seulement si on n'a pas déjà remonté manuellement dans la conversation.
    const container = messagesContainerRef.current;
    if (!container) return;
    function onImageLoad(e: Event) {
      if (!(e.target instanceof HTMLImageElement) || !container) return;
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
      if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
    container.addEventListener("load", onImageLoad, true);
    return () => container.removeEventListener("load", onImageLoad, true);
  }, []);

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
      <div ref={messagesContainerRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
          const isLockedEphemeral = m.isEphemeral && m.imageUrl && !isOwn && !viewedIds.has(m.id);
          const isConsumedEphemeral = m.isEphemeral && m.imageUrl && !isOwn && viewedIds.has(m.id);
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
                {isLockedEphemeral ? (
                  <button
                    type="button"
                    onClick={() => openEphemeralPhoto(m)}
                    className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-accent px-4 py-3 text-paper shadow-sm transition-transform active:scale-95"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="15" rx="2.5" />
                      <circle cx="12" cy="12.5" r="3.5" />
                    </svg>
                    <span className="text-sm font-bold">Photo à voir une fois — appuie</span>
                  </button>
                ) : isConsumedEphemeral ? (
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-paper px-4 py-3 text-mute shadow-sm">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
                      <path d="M4 4l16 16" />
                    </svg>
                    <span className="text-sm font-semibold">Photo vue</span>
                  </div>
                ) : (
                  <>
                    {m.imageUrl && (
                      <a
                        href={m.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`relative block overflow-hidden rounded-2xl ${m.content ? "mb-1" : ""} ${isOwn ? "rounded-br-md" : "rounded-bl-md"}`}
                      >
                        <Image
                          src={m.imageUrl}
                          alt=""
                          width={280}
                          height={280}
                          sizes="280px"
                          className="h-auto max-h-72 w-full max-w-[240px] object-cover"
                        />
                        {m.isEphemeral && isOwn && (
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-bold text-paper">
                            Vue unique
                          </span>
                        )}
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
                  </>
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
            {isEphemeralPick && (
              <span className="absolute bottom-1 left-1 rounded-full bg-ink/70 px-1.5 py-0.5 text-[9px] font-bold text-paper">
                1x
              </span>
            )}
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
        <input ref={formImageInputRef} type="file" name="image" className="hidden" />
        <input type="hidden" name="ephemeral" value={isEphemeralPick ? "1" : "0"} />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraChange}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handleGalleryChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={openCamera}
          aria-label="Prendre une photo (vue une seule fois)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-mute shadow-sm transition-colors hover:text-ink"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
            <circle cx="12" cy="13.5" r="3.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          aria-label="Choisir depuis la pellicule"
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
      {openedPhoto?.imageUrl &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
            onClick={() => setOpenedPhoto(null)}
          >
            <button
              type="button"
              onClick={() => setOpenedPhoto(null)}
              aria-label="Fermer"
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-paper/20 text-paper"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <div className="relative max-h-[80vh] w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <Image
                src={openedPhoto.imageUrl}
                alt=""
                width={800}
                height={800}
                sizes="480px"
                className="h-auto max-h-[80vh] w-full rounded-2xl object-contain"
              />
            </div>
            {openedPhoto.content && <p className="mt-4 max-w-md text-center text-paper">{openedPhoto.content}</p>}
          </div>,
          document.body
        )}
      {cameraOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
            />
            <p className="absolute left-4 top-4 rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-paper">
              📸 Photo à voir une fois
            </p>
            <div className="absolute right-4 top-4 flex items-center gap-2">
              {torchSupported && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  aria-label={torchOn ? "Désactiver le flash" : "Activer le flash"}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-paper ${
                    torchOn ? "bg-accent" : "bg-paper/20"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={closeCamera}
                aria-label="Fermer la caméra"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-paper/20 text-paper"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center">
              <button
                type="button"
                onClick={capturePhoto}
                aria-label="Prendre la photo"
                className="h-16 w-16 rounded-full border-4 border-paper bg-paper/30 transition-transform active:scale-95"
              />
              <button
                type="button"
                onClick={switchCamera}
                aria-label="Changer de caméra"
                className="absolute left-1/2 ml-16 flex h-11 w-11 items-center justify-center rounded-full bg-paper/20 text-paper"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
                  <path d="M9 12a3 3 0 1 0 3-3" />
                  <path d="M9 9V7.5" />
                  <path d="M9 9H7.5" />
                </svg>
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
