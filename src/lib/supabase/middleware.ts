import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parisDateString } from "@/lib/quiz/daily";

const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

// Pronostics de saison désormais ouverts sans date limite (migration 0045, un premier envoi
// n'est jamais bloqué par predictions_lock_at) : redirige vers le premier championnat actif où
// il manque encore un pronostic de saison, une seule fois par jour et par joueur — jamais deux
// fois le même jour même s'il ne l'a pas fait, pour ne pas devenir gênant. Le cookie porte la
// date du jour (pas un simple booléen) : il se "réinitialise" tout seul le lendemain. S'éteint de
// lui-même dès que tous les championnats actifs ont un pronostic pour ce joueur.
const SEASON_PRED_REMINDER_COOKIE = "season_pred_reminder_shown";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (
    user &&
    request.method === "GET" &&
    !request.headers.get("next-router-prefetch") && // jamais sur un simple préchargement de <Link>
    !isPublicPath &&
    !request.nextUrl.pathname.startsWith("/leagues/") &&
    !request.nextUrl.pathname.startsWith("/api/")
  ) {
    const today = parisDateString();
    if (request.cookies.get(SEASON_PRED_REMINDER_COOKIE)?.value !== today) {
      const { data: leagues } = await supabase
        .from("leagues")
        .select("id, football_data_code")
        .eq("active", true);
      const leagueIds = (leagues ?? []).map((l) => l.id);

      const { data: seasons } = await supabase
        .from("seasons")
        .select("id, league_id")
        .in("league_id", leagueIds.length > 0 ? leagueIds : [-1])
        .order("year", { ascending: false });
      // Une seule saison (la plus récente) par championnat, comme partout ailleurs dans l'app.
      const latestSeasonByLeague = new Map<number, number>();
      for (const s of seasons ?? []) if (!latestSeasonByLeague.has(s.league_id)) latestSeasonByLeague.set(s.league_id, s.id);
      const seasonIds = [...latestSeasonByLeague.values()];

      const { data: existing } = await supabase
        .from("season_predictions")
        .select("season_id")
        .eq("user_id", user.id)
        .in("season_id", seasonIds.length > 0 ? seasonIds : [-1]);
      const doneSeasonIds = new Set((existing ?? []).map((e) => e.season_id));

      const missingLeague = (leagues ?? []).find((l) => {
        const seasonId = latestSeasonByLeague.get(l.id);
        return seasonId != null && !doneSeasonIds.has(seasonId);
      });

      if (missingLeague) {
        const leagueUrl = request.nextUrl.clone();
        leagueUrl.pathname = `/leagues/${missingLeague.football_data_code}`;
        leagueUrl.searchParams.set("rappel", "pronostics-saison");
        const redirectResponse = NextResponse.redirect(leagueUrl);
        // Transfère les cookies déjà posés sur `response` (ex: session Supabase tout juste
        // rafraîchie par getUser() ci-dessus) : construire un NextResponse.redirect tout neuf les
        // perdrait sinon, au risque de désynchroniser la session juste après la redirection.
        response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
        response = redirectResponse;
      }
      // Marqué "vu" aujourd'hui dans tous les cas (redirigé ou non) : sans pronostic manquant,
      // pas la peine de repayer ces requêtes à chaque navigation du reste de la journée.
      response.cookies.set(SEASON_PRED_REMINDER_COOKIE, today, { maxAge: 60 * 60 * 24, path: "/" });
    }
  }

  return response;
}
