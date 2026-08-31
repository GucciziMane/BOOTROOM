import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { markChatAsRead } from "./actions";
import { ChatRoom } from "./ChatRoom";
import { linkMuted } from "@/lib/ui";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: messages }, { data: profiles }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id, user_id, content, image_url, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id, username, avatar_url, favorite_team_id"),
  ]);

  const favoriteTeamIds = [...new Set((profiles ?? []).map((p) => p.favorite_team_id).filter((id): id is number => id != null))];
  const { data: favoriteTeams } = await supabase
    .from("teams")
    .select("id, logo_url")
    .in("id", favoriteTeamIds.length > 0 ? favoriteTeamIds : [-1]);
  const teamLogoById = new Map((favoriteTeams ?? []).map((t) => [t.id, t.logo_url]));

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
    .map((m) => ({ id: m.id, userId: m.user_id, content: m.content, imageUrl: m.image_url, createdAt: m.created_at }));

  const { data: reactions } = messages?.length
    ? await supabase
        .from("chat_message_reactions")
        .select("id, message_id, user_id, emoji")
        .in(
          "message_id",
          messages.map((m) => m.id)
        )
    : { data: [] };

  await markChatAsRead();

  return (
    <main className="mx-auto flex h-[calc(100dvh-8rem)] w-full max-w-2xl flex-col overflow-hidden p-6 lg:h-dvh">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-3xl font-bold">3ème mi-temps 🍻</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-paper/60">
        <ChatRoom
          initialMessages={initialMessages}
          initialReactions={reactions ?? []}
          profilesById={profilesById}
          currentUserId={user.id}
        />
      </div>
    </main>
  );
}
