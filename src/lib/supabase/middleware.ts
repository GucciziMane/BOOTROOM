import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parisDateString } from "@/lib/quiz/daily";

const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

// Campagne ponctuelle (pronostics de saison C1 rouverts jusqu'à 17h le 8/09/2026) : redirige
// chacun vers la page une seule fois, à sa toute première navigation du jour — jamais aux suivantes
// même s'il n'a pas encore pronostiqué, pour ne pas devenir gênant. Le cookie porte la date du jour
// (pas un simple booléen) : il se "réinitialise" tout seul le lendemain, aucun nettoyage à prévoir.
// Pas de date de fin codée en dur ici : la vérification lit predictions_lock_at en base à chaque
// fois, donc ce bloc s'éteint tout seul dès que la fenêtre se referme (17h, ou si quelqu'un la
// referme plus tôt) — inutile de revenir le supprimer après coup.
const CL_REMINDER_COOKIE = "cl_pred_reminder_shown";

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
    !request.nextUrl.pathname.startsWith("/leagues/CL") &&
    !request.nextUrl.pathname.startsWith("/api/")
  ) {
    const today = parisDateString();
    if (request.cookies.get(CL_REMINDER_COOKIE)?.value !== today) {
      const { data: league } = await supabase
        .from("leagues")
        .select("id")
        .eq("football_data_code", "CL")
        .maybeSingle();
      const { data: season } = league
        ? await supabase
            .from("seasons")
            .select("id, predictions_lock_at")
            .eq("league_id", league.id)
            .order("year", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

      let shouldRedirect = false;
      if (season && new Date(season.predictions_lock_at) > new Date()) {
        const { data: existing } = await supabase
          .from("season_predictions")
          .select("id")
          .eq("season_id", season.id)
          .eq("user_id", user.id)
          .maybeSingle();
        shouldRedirect = !existing;
      }

      if (shouldRedirect) {
        const clUrl = request.nextUrl.clone();
        clUrl.pathname = "/leagues/CL";
        const redirectResponse = NextResponse.redirect(clUrl);
        // Transfère les cookies déjà posés sur `response` (ex: session Supabase tout juste
        // rafraîchie par getUser() ci-dessus) : construire un NextResponse.redirect tout neuf les
        // perdrait sinon, au risque de désynchroniser la session juste après la redirection.
        response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
        response = redirectResponse;
      }
      // Marqué "vu" aujourd'hui dans tous les cas (redirigé ou non) : sans pronostic à faire (déjà
      // fait, ou fenêtre fermée), pas la peine de repayer ces deux requêtes à chaque navigation du
      // reste de la journée.
      response.cookies.set(CL_REMINDER_COOKIE, today, { maxAge: 60 * 60 * 24, path: "/" });
    }
  }

  return response;
}
