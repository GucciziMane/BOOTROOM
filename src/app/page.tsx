import { Suspense } from "react";
import { BottomNav } from "./BottomNav";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Trophy, MessageCircle, Calendar, ArrowRight, Sparkles, Users, TrendingUp } from "lucide-react";

async function getUserStats() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    const [{ data: profile }, { data: quizzes }, { data: messages }] = await Promise.all([
      supabase.from("profiles").select("username, avatar_url").eq("id", user.id).single(),
      supabase.from("quiz_attempts").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("chat_messages").select("id", { count: "exact" }).eq("user_id", user.id),
    ]);
    
    return {
      username: profile?.username,
      avatarUrl: profile?.avatar_url,
      quizzesCount: quizzes?.[0]?.count ?? 0,
      messagesCount: messages?.[0]?.count ?? 0,
    };
  } catch {
    return null;
  }
}

function StatsCard({ icon: Icon, label, value, href, color }: { 
  icon: React.ElementType; 
  label: string; 
  value: number | string; 
  href: string;
  color: string;
}) {
  return (
    <Link href={href} className="card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </Link>
  );
}

function QuickAction({ icon: Icon, label, desc, href, color }: {
  icon: React.ElementType;
  label: string;
  desc: string;
  href: string;
  color: string;
}) {
  return (
    <Link href={href} className="card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

function HomeContent({ userStats }: { userStats: any }) {
  return (
    <main className="min-h-screen pb-20">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/5">
        <div className="container mx-auto px-4 py-12 sm:py-16">
          {userStats ? (
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Bonjour, {userStats.username} 👋</h1>
                <p className="text-muted-foreground">Prêt à jouer ?</p>
              </div>
              <Link href="/profile">
                {userStats.avatarUrl ? (
                  <img src={userStats.avatarUrl} alt="Avatar" className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/20" loading="lazy" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                    {userStats.username?.[0]?.toUpperCase() ?? "U"}
                  </div>
                )}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Bienvenue sur Bootroom</h1>
              <p className="mb-6 max-w-md text-muted-foreground">L'application ultime pour les fans de football</p>
              <Link href="/quiz" className="btn-primary inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold shadow-lg shadow-primary/25">
                Commencer un quiz <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Stats */}
      {userStats && (
        <section className="container mx-auto px-4 py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatsCard icon={Trophy} label="Quiz joués" value={userStats.quizzesCount} href="/quiz" color="bg-orange-500/10" />
            <StatsCard icon={MessageCircle} label="Messages" value={userStats.messagesCount} href="/chat" color="bg-blue-500/10" />
            <StatsCard icon={Calendar} label="Matchs" value="—" href="/calendar" color="bg-green-500/10" />
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="container mx-auto px-4 pb-8">
        <h2 className="mb-4 text-xl font-semibold">Actions rapides</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction icon={Trophy} label="Quiz" desc="Teste tes connaissances" href="/quiz" color="bg-orange-500/10" />
          <QuickAction icon={MessageCircle} label="Chat" desc="Discute avec la communauté" href="/chat" color="bg-blue-500/10" />
          <QuickAction icon={Calendar} label="Calendrier" desc="Matchs à venir" href="/calendar" color="bg-green-500/10" />
          <QuickAction icon={Users} label="Classement" desc="Voir les meilleurs" href="/leaderboard" color="bg-purple-500/10" />
        </div>
      </section>

      {/* Leagues */}
      <section className="container mx-auto px-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Ligues populaires</h2>
          <Link href="/leagues" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
            Voir tout <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {["Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "Ligue des Champions"].map((league) => (
            <Link key={league} href={`/leagues/${encodeURIComponent(league.toLowerCase().replace(/\s+/g, "-"))}`} className="card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
              <div className="flex items-center justify-between">
                <span className="font-medium">{league}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <BottomNav />
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <main className="min-h-screen pb-20">
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/5">
        <div className="container mx-auto px-4 py-12">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 h-16 w-16 rounded-2xl bg-muted animate-pulse" />
            <div className="mb-3 h-8 w-48 rounded bg-muted animate-pulse" />
            <div className="mb-6 h-4 w-64 rounded bg-muted animate-pulse" />
            <div className="h-12 w-40 rounded-lg bg-muted animate-pulse" />
          </div>
        </div>
      </section>
      <section className="container mx-auto px-4 py-8">
        <div className="mb-4 h-6 w-40 rounded bg-muted animate-pulse" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-4"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-muted animate-pulse" /><div className="flex-1"><div className="mb-2 h-4 w-20 rounded bg-muted animate-pulse" /><div className="h-3 w-32 rounded bg-muted animate-pulse" /></div></div></div></div>
          ))}
        </div>
      </section>
      <BottomNav />
    </main>
  );
}

export default async function HomePage() {
  const userStats = await getUserStats();
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <HomeContent userStats={userStats} />
    </Suspense>
  );
}
EOFcat > src/app/page.tsx << 'EOF'
import { Suspense } from "react";
import { BottomNav } from "./BottomNav";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Trophy, MessageCircle, Calendar, ArrowRight, Sparkles, Users, TrendingUp } from "lucide-react";

async function getUserStats() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    const [{ data: profile }, { data: quizzes }, { data: messages }] = await Promise.all([
      supabase.from("profiles").select("username, avatar_url").eq("id", user.id).single(),
      supabase.from("quiz_attempts").select("id", { count: "exact" }).eq("user_id", user.id),
      supabase.from("chat_messages").select("id", { count: "exact" }).eq("user_id", user.id),
    ]);
    
    return {
      username: profile?.username,
      avatarUrl: profile?.avatar_url,
      quizzesCount: quizzes?.[0]?.count ?? 0,
      messagesCount: messages?.[0]?.count ?? 0,
    };
  } catch {
    return null;
  }
}

function StatsCard({ icon: Icon, label, value, href, color }: { 
  icon: React.ElementType; 
  label: string; 
  value: number | string; 
  href: string;
  color: string;
}) {
  return (
    <Link href={href} className="card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </Link>
  );
}

function QuickAction({ icon: Icon, label, desc, href, color }: {
  icon: React.ElementType;
  label: string;
  desc: string;
  href: string;
  color: string;
}) {
  return (
    <Link href={href} className="card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

function HomeContent({ userStats }: { userStats: any }) {
  return (
    <main className="min-h-screen pb-20">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/5">
        <div className="container mx-auto px-4 py-12 sm:py-16">
          {userStats ? (
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Bonjour, {userStats.username} 👋</h1>
                <p className="text-muted-foreground">Prêt à jouer ?</p>
              </div>
              <Link href="/profile">
                {userStats.avatarUrl ? (
                  <img src={userStats.avatarUrl} alt="Avatar" className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/20" loading="lazy" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                    {userStats.username?.[0]?.toUpperCase() ?? "U"}
                  </div>
                )}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Bienvenue sur Bootroom</h1>
              <p className="mb-6 max-w-md text-muted-foreground">L'application ultime pour les fans de football</p>
              <Link href="/quiz" className="btn-primary inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold shadow-lg shadow-primary/25">
                Commencer un quiz <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Stats */}
      {userStats && (
        <section className="container mx-auto px-4 py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatsCard icon={Trophy} label="Quiz joués" value={userStats.quizzesCount} href="/quiz" color="bg-orange-500/10" />
            <StatsCard icon={MessageCircle} label="Messages" value={userStats.messagesCount} href="/chat" color="bg-blue-500/10" />
            <StatsCard icon={Calendar} label="Matchs" value="—" href="/calendar" color="bg-green-500/10" />
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="container mx-auto px-4 pb-8">
        <h2 className="mb-4 text-xl font-semibold">Actions rapides</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction icon={Trophy} label="Quiz" desc="Teste tes connaissances" href="/quiz" color="bg-orange-500/10" />
          <QuickAction icon={MessageCircle} label="Chat" desc="Discute avec la communauté" href="/chat" color="bg-blue-500/10" />
          <QuickAction icon={Calendar} label="Calendrier" desc="Matchs à venir" href="/calendar" color="bg-green-500/10" />
          <QuickAction icon={Users} label="Classement" desc="Voir les meilleurs" href="/leaderboard" color="bg-purple-500/10" />
        </div>
      </section>

      {/* Leagues */}
      <section className="container mx-auto px-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Ligues populaires</h2>
          <Link href="/leagues" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
            Voir tout <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {["Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "Ligue des Champions"].map((league) => (
            <Link key={league} href={`/leagues/${encodeURIComponent(league.toLowerCase().replace(/\s+/g, "-"))}`} className="card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
              <div className="flex items-center justify-between">
                <span className="font-medium">{league}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <BottomNav />
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <main className="min-h-screen pb-20">
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/5">
        <div className="container mx-auto px-4 py-12">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 h-16 w-16 rounded-2xl bg-muted animate-pulse" />
            <div className="mb-3 h-8 w-48 rounded bg-muted animate-pulse" />
            <div className="mb-6 h-4 w-64 rounded bg-muted animate-pulse" />
            <div className="h-12 w-40 rounded-lg bg-muted animate-pulse" />
          </div>
        </div>
      </section>
      <section className="container mx-auto px-4 py-8">
        <div className="mb-4 h-6 w-40 rounded bg-muted animate-pulse" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-4"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-muted animate-pulse" /><div className="flex-1"><div className="mb-2 h-4 w-20 rounded bg-muted animate-pulse" /><div className="h-3 w-32 rounded bg-muted animate-pulse" /></div></div></div></div>
          ))}
        </div>
      </section>
      <BottomNav />
    </main>
  );
}

export default async function HomePage() {
  const userStats = await getUserStats();
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <HomeContent userStats={userStats} />
    </Suspense>
  );
}
