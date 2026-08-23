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
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id, username, avatar_url"),
  ]);

  const profilesById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, { username: p.username, avatarUrl: p.avatar_url }])
  );

  const initialMessages = (messages ?? [])
    .slice()
    .reverse()
    .map((m) => ({ id: m.id, userId: m.user_id, content: m.content, createdAt: m.created_at }));

  await markChatAsRead();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-1 flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">3ème mi-temps 🍻</h1>
        <Link href="/" className={`text-sm ${linkMuted}`}>
          Retour
        </Link>
      </div>
      <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-sm">
        <ChatRoom initialMessages={initialMessages} profilesById={profilesById} currentUserId={user.id} />
      </div>
    </main>
  );
}
