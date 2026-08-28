import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { linkMuted } from "@/lib/ui";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url, is_admin, chat_last_read_at")
    .eq("id", user!.id)
    .single();

  const { count: unreadChatCount } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .neq("user_id", user!.id)
    .gt("created_at", profile?.chat_last_read_at ?? "1970-01-01");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-1 flex-col p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Boot Room</h1>
        <div className="flex items-center gap-4">
          {profile?.is_admin && (
            <Link href="/admin" className={`text-sm ${linkMuted}`}>
              Administration
            </Link>
          )}
          <Link href="/profile" className="flex items-center gap-2">
            <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-line bg-cream">
              {profile?.avatar_url ? (
                <Image src={profile.avatar_url} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-mute">
                  {(profile?.username ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
          </Link>
          <form action={signOut}>
            <button type="submit" className={`text-sm ${linkMuted}`}>
              Déconnexion
            </button>
          </form>
        </div>
      </div>

      <p className="mt-3 text-lg text-mute">Salut {profile?.username ?? user?.email}.</p>

      <div className="flex flex-1 items-center justify-center">
        <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          <NavCard
            href="/leagues"
            title="Mes prédictions 🔮"
            description="Buteur, passeur, top 3, flop 3, équipe surprise et équipe flop, par championnat."
          />
          <NavCard
            href="/calendar"
            title="Pronostics 🎯"
            description="Calendrier des matchs : score et buteur, championnat par championnat."
          />
          <NavCard
            href="/calendar/classements"
            title={"Classements & buteurs 🏆"}
            description="Le classement réel de chaque championnat, mis à jour après chaque match, plus les buteurs et passeurs."
          />
          <NavCard
            href="/leaderboard"
            title="Classement général 🏅"
            description="Le total des points de chacun entre potes, et le détail par championnat."
          />
          <NavCard
            href="/chat"
            title="3ème mi‑temps 🍻"
            description="La discussion entre tous les membres."
            badgeCount={unreadChatCount ?? 0}
          />
          <NavCard
            href="/quiz"
            title="Quiz du jour 🧠"
            description="10 questions sur le foot, un nouveau quiz chaque jour à minuit. Classement quotidien entre potes."
          />
        </div>
      </div>
    </main>
  );
}

function NavCard({
  href,
  title,
  description,
  badgeCount,
}: {
  href: string;
  title: string;
  description: string;
  badgeCount?: number;
}) {
  return (
    <Link
      href={href}
      className="relative flex min-h-[160px] flex-col items-center justify-center rounded-2xl border-2 border-line bg-paper p-6 text-center shadow-sm transition-colors hover:border-ink hover:bg-cream lg:min-h-[200px] lg:p-8"
    >
      {!!badgeCount && (
        <span className="absolute right-4 top-4 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-paper">
          {badgeCount}
        </span>
      )}
      <span className="text-3xl font-bold lg:text-2xl">{title}</span>
      <span className="mt-3 text-base text-mute">{description}</span>
    </Link>
  );
}
