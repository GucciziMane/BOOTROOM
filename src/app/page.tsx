import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { getFavoriteTeamLeagueGroups } from "@/lib/favorite-teams";
import { getClubHomeData } from "@/lib/club-home";
import { getLiveMatches } from "@/lib/live-matches";
import { FavoriteTeamBadge } from "@/app/profile/FavoriteTeamBadge";
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
      .select("username, avatar_url, is_admin, chat_last_read_at, favorite_team_id")
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
    // Un seul mode désormais : plus de choix club/trophée (cf. ThemeModeToggle, retiré de cette
    // page) — dès qu'un club favori est défini, sa vue s'affiche.
    profile?.favorite_team_id ? getClubHomeData(supabase, profile.favorite_team_id) : Promise.resolve(null),
    getLiveMatches(supabase),
  ]);

  // Même carrousel de navigation dans les deux modes (club favori ou non) : seul le contenu au-
  // dessus change (bandeau club + infos), le fond sombre et l'accès au reste de l'appli restent
  // identiques — cf. layout.tsx, `stadiumMode` n'est plus exclusif du thème club.
  const navCards = [
    {
      href: "/calendar",
      emoji: "🎯",
      title: "Pronostics",
      description: "Calendrier des matchs : score et buteur, championnat par championnat.",
    },
    {
      href: "/calendar/classements",
      emoji: "🏆",
      title: "Classement",
      description:
        "Le classement réel de chaque championnat, mis à jour après chaque match, plus les buteurs et passeurs.",
    },
    {
      href: "/leaderboard",
      emoji: "🏅",
      title: "Podium",
      description: "Le total des points de chacun entre potes, et le détail par championnat.",
    },
    {
      href: "/chat",
      emoji: "🍻",
      title: "3ème mi‑temps",
      description: "La discussion entre tous les membres.",
      badgeCount: unreadChatCount ?? 0,
    },
    {
      href: "/quiz",
      emoji: "🧠",
      title: "Quiz du jour",
      description: "10 questions sur le foot, un nouveau quiz chaque jour à minuit. Classement quotidien entre potes.",
    },
  ];

  return (
    <main
      // h-full ne suffit pas ici : body n'a que min-h-full (pas h-full, volontaire pour que les
      // pages normales restent scrollables si leur contenu dépasse un écran), donc un pourcentage
      // hérité à travers cette chaîne ne se résout jamais à une hauteur ferme — main grossissait
      // simplement à la taille de son contenu au lieu d'être plafonné à l'écran. Ancré directement
      // sur le viewport réel (moins les paddings connus posés par <body>, cf. layout.tsx) plutôt
      // que de dépendre de cette chaîne de hauteurs.
      // En mode club, le contenu (bandeau + carrousel) dépasse volontairement un écran — une
      // hauteur FIXE (h-[calc(...)]) combinée à min-h-0 plus bas dans l'arbre masquait alors la
      // fin du carrousel sans qu'aucun scroll ne puisse jamais l'atteindre (overflow:visible sur
      // un enfant flex avec min-h-0 ne fait pas grandir le scrollHeight du document). min-h (pas
      // h) laisse ce mode grandir avec son contenu tout en remplissant l'écran quand il est court.
      className={`relative mx-auto flex w-full max-w-7xl flex-1 flex-col p-6 ${
        clubHomeData
          ? "min-h-[calc(100dvh-env(safe-area-inset-top)-8rem)] lg:min-h-[calc(100dvh-env(safe-area-inset-top))]"
          : "h-[calc(100dvh-env(safe-area-inset-top)-8rem)] min-h-0 overflow-hidden lg:h-[calc(100dvh-env(safe-area-inset-top))]"
      }`}
    >
      {/* Photo de stade en fond : posée globalement dans layout.tsx (StadiumBackdrop), visible sur
          toutes les pages y compris ici en mode club — cf. layout.tsx, `stadiumMode`. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col text-paper">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Boot Room</h1>
          <div className="flex items-center gap-4">
            {profile?.is_admin && (
              <Link href="/admin" className="text-sm font-bold text-paper/80 hover:text-paper">
                Administration
              </Link>
            )}
            <Link href="/profile" className="relative flex h-16 w-16 shrink-0 items-center gap-2">
              <span className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-paper/30 bg-surface-inverse/30">
                {profile?.avatar_url ? (
                  <Image src={profile.avatar_url} alt="" fill sizes="64px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-paper/90">
                    {(profile?.username ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <FavoriteTeamBadge logoUrl={favoriteTeamLogoUrl ?? null} size={22} />
            </Link>
            <form action={signOut}>
              <button type="submit" className="text-sm font-bold text-paper/80 hover:text-paper">
                Déconnexion
              </button>
            </form>
          </div>
        </div>

        <p className="mt-3 text-lg text-paper/85">Salut {profile?.username ?? user?.email}.</p>

        <div className="mt-4">
          <LiveMatchesBanner initialMatches={liveMatches} variant="dark" />
        </div>

        {clubHomeData ? (
          <div className="mt-5">
            <ClubHomeDashboard data={clubHomeData} />
            <div className="mt-7">
              <NavCardCarousel cards={navCards} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <NavCardCarousel cards={navCards} />
          </div>
        )}

        {!profile?.favorite_team_id && <FavoriteTeamOnboarding leagues={leagues} />}
      </div>
    </main>
  );
}
