import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface PredictionHistoryRow {
  matchId: number;
  kickoffAt: string;
  matchday: number | null;
  leagueCode: string;
  leagueName: string;
  homeName: string;
  homeLogoUrl: string | null;
  awayName: string;
  awayLogoUrl: string | null;
  isFinished: boolean;
  predictedHome: number;
  predictedAway: number;
  realHome: number | null;
  realAway: number | null;
  scorerName: string | undefined;
  assistName: string | undefined;
  scorerValid: boolean | null;
  assistValid: boolean | null;
  scorePoints: number;
  scorerPoints: number;
  assistPoints: number;
  totalPoints: number | null;
}

/**
 * Historique des pronostics d'un utilisateur, du plus récent au plus ancien.
 *
 * Utilise le client "normal" (RLS), pas le service role : pour un `userId` différent de
 * l'utilisateur connecté, la policy sur match_predictions ("own match predictions always
 * visible, others visible once locked") ne renvoie alors que les pronostics déjà verrouillés —
 * exactement le comportement voulu pour consulter le profil d'un autre joueur du classement,
 * sans rien à filtrer nous-mêmes ici.
 */
export async function getPredictionHistory(supabase: Client, userId: string): Promise<PredictionHistoryRow[]> {
  const { data: predictions } = await supabase
    .from("match_predictions")
    .select(
      "match_id, predicted_home_score, predicted_away_score, predicted_scorer_player_id, predicted_assist_player_id, points_awarded"
    )
    .eq("user_id", userId);

  const matchIds = (predictions ?? []).map((p) => p.match_id);

  const [{ data: matches }, { data: ledger }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, league_id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, matchday")
      .in("id", matchIds.length > 0 ? matchIds : [-1]),
    supabase
      .from("points_ledger")
      .select("source_id, source_type, points")
      .eq("user_id", userId)
      .in("source_type", ["match_score", "match_scorer", "match_assist"])
      .in("source_id", matchIds.length > 0 ? matchIds : [-1]),
  ]);

  const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

  const leagueIds = [...new Set((matches ?? []).map((m) => m.league_id))];
  const teamIds = [...new Set((matches ?? []).flatMap((m) => [m.home_team_id, m.away_team_id]))];
  const playerIds = [
    ...new Set(
      (predictions ?? [])
        .flatMap((p) => [p.predicted_scorer_player_id, p.predicted_assist_player_id])
        .filter((id): id is number => id != null)
    ),
  ];

  const [{ data: leagues }, { data: teams }, { data: players }] = await Promise.all([
    supabase.from("leagues").select("id, name, football_data_code").in("id", leagueIds.length > 0 ? leagueIds : [-1]),
    supabase.from("teams").select("id, name, logo_url").in("id", teamIds.length > 0 ? teamIds : [-1]),
    supabase.from("players").select("id, name").in("id", playerIds.length > 0 ? playerIds : [-1]),
  ]);

  const leagueById = new Map((leagues ?? []).map((l) => [l.id, l]));
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const pointsByMatchAndType = new Map<string, number>();
  for (const l of ledger ?? []) {
    pointsByMatchAndType.set(`${l.source_id}:${l.source_type}`, l.points);
  }

  return (predictions ?? [])
    .map((p): PredictionHistoryRow | null => {
      const match = matchById.get(p.match_id);
      if (!match) return null;
      const league = leagueById.get(match.league_id);
      const home = teamById.get(match.home_team_id);
      const away = teamById.get(match.away_team_id);
      const isFinished = match.status === "finished" && match.home_score != null && match.away_score != null;

      const scorerName = p.predicted_scorer_player_id != null ? playerNameById.get(p.predicted_scorer_player_id) : undefined;
      const assistName = p.predicted_assist_player_id != null ? playerNameById.get(p.predicted_assist_player_id) : undefined;
      // Dérivé des points réellement attribués (points_ledger), pas d'un nouveau calcul de
      // correspondance ici : évite que l'affichage se désynchronise de la "garantie
      // buteur/passeur" (voir process-scoring) si sa logique évolue un jour.
      const scorerValid =
        !isFinished || p.predicted_scorer_player_id == null
          ? null
          : (pointsByMatchAndType.get(`${match.id}:match_scorer`) ?? 0) > 0;
      const assistValid =
        !isFinished || p.predicted_assist_player_id == null
          ? null
          : (pointsByMatchAndType.get(`${match.id}:match_assist`) ?? 0) > 0;

      return {
        matchId: match.id,
        kickoffAt: match.kickoff_at,
        matchday: match.matchday,
        leagueCode: league?.football_data_code ?? "",
        leagueName: league?.name ?? "",
        homeName: home?.name ?? "?",
        homeLogoUrl: home?.logo_url ?? null,
        awayName: away?.name ?? "?",
        awayLogoUrl: away?.logo_url ?? null,
        isFinished,
        predictedHome: p.predicted_home_score,
        predictedAway: p.predicted_away_score,
        realHome: match.home_score,
        realAway: match.away_score,
        scorerName,
        assistName,
        scorerValid,
        assistValid,
        scorePoints: pointsByMatchAndType.get(`${match.id}:match_score`) ?? 0,
        scorerPoints: pointsByMatchAndType.get(`${match.id}:match_scorer`) ?? 0,
        assistPoints: pointsByMatchAndType.get(`${match.id}:match_assist`) ?? 0,
        totalPoints: p.points_awarded,
      };
    })
    .filter((r): r is PredictionHistoryRow => r !== null)
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
}
