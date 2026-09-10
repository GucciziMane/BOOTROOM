import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { getFavoriteTeamLeagueGroups } from "@/lib/favorite-teams";
import { getClubHomeData } from "@/lib/club-home";
import { getLiveMatches } from "@/lib/live-matches";
import { linkMuted } from "@/lib/ui";
import { FavoriteTeamBadge } from "@/app/profile/FavoriteTeamBadge";
import { ThemeModeToggle } from "@/app/profile/ThemeModeToggle";
import { FavoriteTeamOnboarding } from "./FavoriteTeamOnboarding";
import { ClubHomeDashboard } from "./ClubHomeDashboard";
import { LiveMatchesBanner } from "./LiveMatchesBanner";
import { NavCardCarousel } from "./NavCardCarousel";

export default async function DashboardPage() {
  const supabase = await createClient();
  // getSession() : le proxy a déjà validé la session pour cette requête (voir layout.tsx), pas
  // besoin de repayer un aller-retour réseau à Supabase Auth ici.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // Les deux premiers ne dépendent que de `user`, pas l'un de l'autre : lancés en parallèle
  // plutôt qu'à la suite pour ne pas payer deux allers-retours Supabase l'un après l'autre.
  const [{ data: profile }, leagues] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, avatar_url, is_admin, chat_last_read_at, favorite_team_id, use_club_theme")
      .eq("id", user!.id)
      .single(),
    getFavoriteTeamLeagueGroups(supabase),
  ]);
  const favoriteTeamLogoUrl = leagues
    .flatMap((l) => l.teams)
    .find((t) => t.id === profile?.favorite_team_id)?.logoUrl;

  // Pareil ici : le compteur de messages non lus et les données du club favori dépendent de
  // `profile` mais pas l'un de l'autre.
  const [{ count: unreadChatCount }, clubHomeData, liveMatches] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      // .neq exclut les lignes user_id NULL en SQL (NULL <> x n'est jamais vrai) : sans le
      // "or", les récaps de journée (postés sans auteur, cf. postMatchdayRecaps) ne compteraient
      // jamais comme non lus.
      .or(`user_id.neq.${user!.id},user_id.is.null`)
      .gt("created_at", profile?.chat_last_read_at ?? "1970-01-01"),
    profile?.use_club_theme && profile.favorite_team_id
      ? getClubHomeData(supabase, profile.favorite_team_id)
      : Promise.resolve(null),
    getLiveMatches(supabase),
  ]);

  return (
    <main
      // h-full ne suffit pas ici : body n'a que min-h-full (pas h-full, volontaire pour que les
      // pages normales restent scrollables si leur contenu dépasse un écran), donc un pourcentage
      // hérité à travers cette chaîne ne se résout jamais à une hauteur ferme — main grossissait
      // simplement à la taille de son contenu au lieu d'être plafonné à l'écran. Ancré directement
      // sur le viewport réel (moins les paddings connus posés par <body>, cf. layout.tsx) plutôt
      // que de dépendre de cette chaîne de hauteurs.
      className={`relative mx-auto flex h-[calc(100dvh-env(safe-area-inset-top)-8rem)] min-h-0 w-full max-w-7xl flex-1 flex-col p-6 lg:h-[calc(100dvh-env(safe-area-inset-top))] ${
        clubHomeData ? "" : "overflow-hidden"
      }`}
    >
      {!clubHomeData && (
        // Pas de thème de club actif : photo de stade en fond plutôt que la page neutre, pour que
        // l'écran d'accueil ait tout de suite un vrai visuel "produit sport" au lieu d'un fond uni.
        // fixed (pas absolute) : couvre tout le viewport, jusque sous la barre de statut et sous
        // la BottomNav — sinon confiné à la boîte de main, donc sous les paddings safe-area du
        // body (fond clair visible en haut/bas). Même convention que le filigrane de blason
        // (ThemeApplier.tsx) : bloc positionné z-0, le contenu réel passe dans un wrapper
        // relative z-10 pour peindre par-dessus.
        <div className="fixed inset-0 z-0" aria-hidden="true">
          <Image
            src="/images/dashboard-hero.jpg"
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/78" />
        </div>
      )}

      <div className={`relative z-10 flex min-h-0 flex-1 flex-col ${clubHomeData ? "" : "text-paper"}`}>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Boot Room</h1>
          <div className="flex items-center gap-4">
            {profile?.is_admin && (
              <Link
                href="/admin"
                className={clubHomeData ? `text-sm ${linkMuted}` : "text-sm font-bold text-paper/80 hover:text-paper"}
              >
                Administration
              </Link>
            )}
            <Link href="/profile" className="relative flex h-16 w-16 shrink-0 items-center gap-2">
              <span
                className={`relative h-16 w-16 overflow-hidden rounded-full border-2 ${
                  clubHomeData ? "border-line bg-cream" : "border-paper/30 bg-ink/30"
                }`}
              >
                {profile?.avatar_url ? (
                  <Image src={profile.avatar_url} alt="" fill sizes="64px" className="object-cover" />
                ) : (
                  <span
                    className={`flex h-full w-full items-center justify-center text-2xl font-bold ${
                      clubHomeData ? "text-mute" : "text-paper/90"
                    }`}
                  >
                    {(profile?.username ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <FavoriteTeamBadge logoUrl={favoriteTeamLogoUrl ?? null} size={22} />
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className={clubHomeData ? `text-sm ${linkMuted}` : "text-sm font-bold text-paper/80 hover:text-paper"}
              >
                Déconnexion
              </button>
            </form>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className={`text-lg ${clubHomeData ? "text-mute" : "text-paper/85"}`}>
            Salut {profile?.username ?? user?.email}.
          </p>
          <div className="flex items-center gap-2">
            <ThemeModeToggle
              initialUseClubTheme={profile?.use_club_theme ?? false}
              favoriteTeamLogoUrl={favoriteTeamLogoUrl ?? null}
              hasFavoriteTeam={!!profile?.favorite_team_id}
            />
          </div>
        </div>

        <div className="mt-4">
          <LiveMatchesBanner initialMatches={liveMatches} variant={clubHomeData ? "light" : "dark"} />
        </div>

        {clubHomeData ? (
          <div className="mt-5">
            <ClubHomeDashboard data={clubHomeData} />
            <div className="mt-7">
              <div className="mb-2 text-sm font-bold text-mute">Le reste de l&rsquo;appli</div>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                <QuickLink href="/calendar" emoji="🎯" label="Pronostics" />
                <QuickLink href="/calendar/classements" emoji="🏆" label="Classements" />
                <QuickLink href="/leaderboard" emoji="🏅" label="Général" />
                <QuickLink href="/chat" emoji="🍻" label="Chat" badgeCount={unreadChatCount ?? 0} />
                <QuickLink href="/quiz" emoji="🧠" label="Quiz" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <NavCardCarousel
              cards={[
                {
                  href: "/calendar",
                  title: "Pronostics 🎯",
                  description: "Calendrier des matchs : score et buteur, championnat par championnat.",
                },
                {
                  href: "/calendar/classements",
                  title: "Classements & buteurs 🏆",
                  description:
                    "Le classement réel de chaque championnat, mis à jour après chaque match, plus les buteurs et passeurs.",
                },
                {
                  href: "/leaderboard",
                  title: "Classement général 🏅",
                  description: "Le total des points de chacun entre potes, et le détail par championnat.",
                },
                {
                  href: "/chat",
                  title: "3ème mi‑temps 🍻",
                  description: "La discussion entre tous les membres.",
                  badgeCount: unreadChatCount ?? 0,
                },
                {
                  href: "/quiz",
                  title: "Quiz du jour 🧠",
                  description: "10 questions sur le foot, un nouveau quiz chaque jour à minuit. Classement quotidien entre potes.",
                },
              ]}
            />
          </div>
        )}

        {!profile?.favorite_team_id && <FavoriteTeamOnboarding leagues={leagues} />}
      </div>
    </main>
  );
}

function QuickLink({
  href,
  emoji,
  label,
  badgeCount,
}: {
  href: string;
  emoji: string;
  label: string;
  badgeCount?: number;
}) {
  return (
    <Link
      href={href}
      // Sans ça, ces 5 raccourcis (tous vers une page dynamique à plusieurs allers-retours
      // Supabase) préchargent tous en arrière-plan dès l'affichage du dashboard — le tout premier
      // écran vu après connexion, le pire moment pour saturer Supabase de requêtes inutiles.
      prefetch={false}
      className="relative flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-paper px-2 py-3 text-center transition-colors hover:border-ink hover:bg-cream"
    >
      {!!badgeCount && (
        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-paper">
          {badgeCount}
        </span>
      )}
      <span className="text-xl">{emoji}</span>
      <span className="text-[11px] font-bold leading-tight">{label}</span>
    </Link>
  );
}
