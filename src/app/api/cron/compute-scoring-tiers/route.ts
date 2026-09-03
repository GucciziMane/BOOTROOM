import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeScoringTiers, computeAssistTiers, type ScoringTierInput, type AssistTierInput } from "@/lib/scoring/tiers";
import type { Position } from "@/types/database";

/**
 * Recalcule le tier de probabilité de but ET de passe décisive de chaque joueur (poste + forme),
 * à partir des buts/passes déjà enregistrés cette saison (match_goals) et du nombre de matchs
 * joués par équipe (proxy du temps de jeu, faute de minutes précises côté sources gratuites).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabase = createServiceRoleClient();
  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, league_id")
    .in("status", ["upcoming", "in_progress"]);

  if (seasonsError || !seasons) {
    return NextResponse.json({ error: seasonsError?.message ?? "seasons introuvables" }, { status: 500 });
  }

  const summary: Array<{ seasonId: number; players: number; error?: string }> = [];

  for (const season of seasons) {
    try {
      const { data: teams } = await supabase.from("teams").select("id").eq("league_id", season.league_id);
      const teamIds = (teams ?? []).map((t) => t.id);
      if (teamIds.length === 0) {
        summary.push({ seasonId: season.id, players: 0 });
        continue;
      }

      const { data: players } = await supabase
        .from("players")
        .select("id, position, team_id")
        .in("team_id", teamIds)
        .is("left_at", null);

      const { data: finishedMatches } = await supabase
        .from("matches")
        .select("id, home_team_id, away_team_id")
        .eq("season_id", season.id)
        .eq("status", "finished");

      const matchesPlayedByTeam = new Map<number, number>();
      const matchIds: number[] = [];
      for (const m of finishedMatches ?? []) {
        matchesPlayedByTeam.set(m.home_team_id, (matchesPlayedByTeam.get(m.home_team_id) ?? 0) + 1);
        matchesPlayedByTeam.set(m.away_team_id, (matchesPlayedByTeam.get(m.away_team_id) ?? 0) + 1);
        matchIds.push(m.id);
      }

      const goalsByPlayer = new Map<number, number>();
      const assistsByPlayer = new Map<number, number>();
      if (matchIds.length > 0) {
        const { data: goals } = await supabase
          .from("match_goals")
          .select("player_id, assist_player_id")
          .in("match_id", matchIds);
        for (const g of goals ?? []) {
          if (g.player_id) goalsByPlayer.set(g.player_id, (goalsByPlayer.get(g.player_id) ?? 0) + 1);
          if (g.assist_player_id) assistsByPlayer.set(g.assist_player_id, (assistsByPlayer.get(g.assist_player_id) ?? 0) + 1);
        }
      }

      const scoringInputs: ScoringTierInput[] = (players ?? []).map((p) => {
        const matchesPlayed = matchesPlayedByTeam.get(p.team_id) ?? 0;
        const goals = goalsByPlayer.get(p.id) ?? 0;
        return {
          playerId: p.id,
          position: p.position as Position,
          minutesPlayed: matchesPlayed * 90,
          goalsPer90: matchesPlayed > 0 ? goals / matchesPlayed : null,
        };
      });
      const assistInputs: AssistTierInput[] = (players ?? []).map((p) => {
        const matchesPlayed = matchesPlayedByTeam.get(p.team_id) ?? 0;
        const assists = assistsByPlayer.get(p.id) ?? 0;
        return {
          playerId: p.id,
          position: p.position as Position,
          minutesPlayed: matchesPlayed * 90,
          assistsPer90: matchesPlayed > 0 ? assists / matchesPlayed : null,
        };
      });

      if (scoringInputs.length === 0) {
        summary.push({ seasonId: season.id, players: 0 });
        continue;
      }

      const scoringTiers = computeScoringTiers(scoringInputs);
      const scoringRows = scoringInputs.map((i) => ({
        player_id: i.playerId,
        season_id: season.id,
        tier: scoringTiers.get(i.playerId)!,
        goals_per_90: i.goalsPer90,
        computed_at: new Date().toISOString(),
      }));

      const assistTiers = computeAssistTiers(assistInputs);
      const assistRows = assistInputs.map((i) => ({
        player_id: i.playerId,
        season_id: season.id,
        tier: assistTiers.get(i.playerId)!,
        assists_per_90: i.assistsPer90,
        computed_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from("player_scoring_tier")
        .upsert(scoringRows, { onConflict: "player_id,season_id" });
      if (upsertError) throw new Error(upsertError.message);

      const { error: assistUpsertError } = await supabase
        .from("player_assist_tier")
        .upsert(assistRows, { onConflict: "player_id,season_id" });
      if (assistUpsertError) throw new Error(assistUpsertError.message);

      summary.push({ seasonId: season.id, players: scoringRows.length });
    } catch (err) {
      summary.push({ seasonId: season.id, players: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ summary });
}
