import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { markChatAsRead } from "./actions";
import { ChatRoom } from "./ChatRoom";
import { BackLink } from "@/app/BackLink";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: messages }, { data: profiles }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id, user_id, content, image_url, is_ephemeral, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id, username, avatar_url, favorite_team_id"),
  ]);

  const favoriteTeamIds = [...new Set((profiles ?? []).map((p) => p.favorite_team_id).filter((id): id is number => id != null))];

  // Aucune de ces requêtes ne dépend du résultat d'une autre (favoriteTeams ne dépend que de
  // `profiles`, reactions/views que de `messages`, markChatAsRead que de `user.id`, déjà connus
  // à ce stade) : tout part en parallèle plutôt qu'en 3 étapes séquentielles.
  const messageIds = (messages ?? []).map((m) => m.id);
  const [{ data: favoriteTeams }, { data: reactions }, { data: views }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, logo_url")
      .in("id", favoriteTeamIds.length > 0 ? favoriteTeamIds : [-1]),
    messageIds.length > 0
      ? supabase.from("chat_message_reactions").select("id, message_id, user_id, emoji").in("message_id", messageIds)
      : Promise.resolve({ data: [] }),
    messageIds.length > 0
      ? supabase.from("chat_message_views").select("message_id").eq("user_id", user.id).in("message_id", messageIds)
      : Promise.resolve({ data: [] }),
    markChatAsRead(user.id),
  ]);
  const teamLogoById = new Map((favoriteTeams ?? []).map((t) => [t.id, t.logo_url]));
  const viewedMessageIds = (views ?? []).map((v) => v.message_id);

  const profilesById = Object.fromEntries(
    (profiles ?? []).map((p) => [
      p.id,
      {
        username: p.username,
        avatarUrl: p.avatar_url,
        favoriteTeamLogoUrl: p.favorite_team_id ? (teamLogoById.get(p.favorite_team_id) ?? null) : null,
      },
    ])
  );

  const initialMessages = (messages ?? [])
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      userId: m.user_id,
      content: m.content,
      imageUrl: m.image_url,
      isEphemeral: m.is_ephemeral,
      createdAt: m.created_at,
    }));

  return (
    <main className="mx-auto flex h-[calc(100dvh-4.75rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col overflow-hidden p-6 lg:h-dvh">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-3xl font-bold">3ème mi-temps 🍻</h1>
        <BackLink href="/" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-paper/60">
        <ChatRoom
          initialMessages={initialMessages}
          initialReactions={reactions ?? []}
          initialViewedMessageIds={viewedMessageIds}
          profilesById={profilesById}
          currentUserId={user.id}
        />
      </div>
    </main>
  );
}
