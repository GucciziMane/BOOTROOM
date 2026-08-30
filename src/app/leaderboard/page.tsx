import { Suspense } from "react";
import { BottomNav } from "../BottomNav";
import { createClient } from "@/lib/supabase/server";
import { Trophy, Medal, Award, TrendingUp } from "lucide-react";

async function getLeaderboard() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, total_points")
      .order("total_points", { ascending: false })
      .limit(50);
    
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
  if (rank === 3) return <Award className="h-5 w-5 text-orange-500" />;
  return <span className="flex h-5 w-5 items-center justify-center text-sm font-bold text-muted-foreground">{rank}</span>;
}

function LeaderboardContent({ players }: { players: any[] }) {
  return (
    <main className="min-h-screen pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Classement</h1>
          <p className="text-muted-foreground">Les meilleurs joueurs de Bootroom</p>
        </div>

        <div className="card overflow-hidden">
          <div className="divide-y">
            {players.map((player, index) => (
              <div
                key={player.id}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center">
                  <RankBadge rank={index + 1} />
                </div>
                
                {player.avatar_url ? (
                  <img
                    src={player.avatar_url}
                    alt={player.username}
                    className="h-10 w-10 rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-semibold">
                    {player.username?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                
                <div className="flex-1">
                  <p className="font-medium">{player.username}</p>
                </div>
                
                <div className="text-right">
                  <p className="font-bold text-primary">{player.total_points || 0}</p>
                  <p className="text-xs text-muted-foreground">points</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <main className="min-h-screen pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-2 h-8 w-40 rounded bg-muted animate-pulse" />
          <div className="mx-auto h-4 w-64 rounded bg-muted animate-pulse" />
        </div>
        <div className="card">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="h-8 w-8 rounded bg-muted animate-pulse" />
              <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
              <div className="flex-1">
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-8 w-16 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

export default async function LeaderboardPage() {
  const players = await getLeaderboard();
  
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LeaderboardContent players={players} />
    </Suspense>
  );
}
