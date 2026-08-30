import { Suspense } from "react";
import { BottomNav } from "../BottomNav";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { User, Mail, Settings, LogOut, Shield, Palette, Star } from "lucide-react";
import { logout } from "./actions";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { AvatarForm } from "./AvatarForm";

async function getProfile() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    
    return { user, profile };
  } catch {
    redirect("/login");
  }
}

function ProfileContent({ user, profile }: { user: any; profile: any }) {
  return (
    <main className="min-h-screen pb-20">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Profil</h1>
          <p className="text-muted-foreground">Gère ton compte</p>
        </div>

        {/* Avatar & Info */}
        <div className="card p-6 mb-6">
          <div className="flex flex-col items-center">
            <AvatarForm currentAvatar={profile?.avatar_url} />
            <div className="mt-4 text-center">
              <p className="text-xl font-bold">{profile?.username || user.email}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="card divide-y mb-6">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Palette className="h-5 w-5 text-muted-foreground" />
              <span>Thème</span>
            </div>
            <ThemeModeToggle />
          </div>
          
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Star className="h-5 w-5 text-muted-foreground" />
              <span>Équipe favorite</span>
            </div>
            <span className="text-sm text-muted-foreground">Configurer →</span>
          </div>
          
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <span>Vie privée</span>
            </div>
            <span className="text-sm text-muted-foreground">→</span>
          </div>
          
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <span>Paramètres</span>
            </div>
            <span className="text-sm text-muted-foreground">→</span>
          </div>
        </div>

        {/* Logout */}
        <form action={logout}>
          <button type="submit" className="btn-secondary w-full py-3 text-destructive hover:bg-destructive/10">
            <LogOut className="h-4 w-4 mr-2" />
            Se déconnecter
          </button>
        </form>
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
          <div className="mx-auto mb-2 h-8 w-24 rounded bg-muted animate-pulse" />
          <div className="mx-auto h-4 w-40 rounded bg-muted animate-pulse" />
        </div>
        <div className="card p-6 mb-6">
          <div className="h-24 w-24 rounded-full bg-muted animate-pulse mx-auto" />
          <div className="mt-4 h-6 w-40 rounded bg-muted animate-pulse mx-auto" />
          <div className="mt-2 h-4 w-60 rounded bg-muted animate-pulse mx-auto" />
        </div>
        <div className="card divide-y">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 rounded bg-muted animate-pulse" />
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-4 w-16 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

export default async function ProfilePage() {
  const { user, profile } = await getProfile();
  
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ProfileContent user={user} profile={profile} />
    </Suspense>
  );
}
