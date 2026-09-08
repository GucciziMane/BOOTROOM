import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeScoringTiers, computeAssistTiers, type ScoringTierInput, type AssistTierInput } from "@/lib/scoring/tiers";
import type { Position } from "@/types/database";

export interface SubstitutionEvent {
  playerOutId: number | null;
  playerInId: number | null;
  minute: number | null;
}

function clampMinute(minute: number | null): number | null {
  if (minute === null || Number.isNaN(minute)) return null;
  return Math.max(0, Math.min(minute, 90));
}

/**
 * Minutes créditées à un joueur pour UN match précis, à partir des événements de
 * substitution connus pour ce match (source : match_substitutions, elle-même alimentée par un
 * rapprochement de nom Highlightly/ESPN — même niveau de confiance que celui déjà utilisé par
 * process-scoring pour la "garantie buteur/passeur").
 *
 * Ne devine jamais un nombre non prouvé par les données : 90 par défaut (aucune preuve
 * individuelle pour ce joueur sur ce match — comportement strictement identique à l'ancien
 * proxy équipe), réduit uniquement quand une sortie/entrée est documentée pour LUI sur CE match.
 * Un entrant sans minute connue reçoit 0 (on sait qu'il n'a pas fait 90 minutes, sans savoir
 * combien) — jamais 90, qui validerait une affirmation que la donnée elle-même contredit.
 */
export function resolvePlayerMatchMinutes(playerId: number, subsForMatch: SubstitutionEvent[]): number {
  // Déduplication défensive : le pipeline d'ingestion remplace déjà tout un match en un seul
  // DELETE+INSERT à chaque sync (sync-fixtures), donc un doublon ne devrait jamais apparaître ici.
  const seen = new Set<string>();
  const relevant = subsForMatch.filter((s) => {
    if (s.playerOutId !== playerId && s.playerInId !== playerId) return false;
    const key = `${s.playerOutId ?? ""}:${s.playerInId ?? ""}:${s.minute ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (relevant.length === 0) return 90; // aucune preuve individuelle -> proxy inchangé

  const outEvents = relevant.filter((s) => s.playerOutId === playerId);
  const inEvents = relevant.filter((s) => s.playerInId === playerId);

  // Entré ET sorti dans le même match : fenêtre bornée entrée -> sortie.
  if (outEvents.length === 1 && inEvents.length === 1) {
    const enter = clampMinute(inEvents[0].minute);
    const exit = clampMinute(outEvents[0].minute);
    if (enter !== null && exit !== null && exit >= enter) return exit - enter;
    return 0; // incohérent ou minute manquante -> jamais deviné
  }

  // Titulaire sorti, un seul événement de sortie.
  if (outEvents.length === 1 && inEvents.length === 0) {
    const exit = clampMinute(outEvents[0].minute);
    return exit ?? 90; // minute inconnue -> repli identique à "aucune preuve"
  }

  // Remplaçant entré, un seul événement d'entrée.
  if (inEvents.length === 1 && outEvents.length === 0) {
    const enter = clampMinute(inEvents[0].minute);
    if (enter === null) return 0; // on sait qu'il n'a pas fait 90, sans savoir combien
    return 90 - enter;
  }

  // Événements multiples/incohérents pour le même joueur sur le même match : jamais moyenné
  // ni deviné. On retient la sortie documentée la plus précoce si elle existe (la plus sûre),
  // sinon 0 (on sait au moins qu'il n'a pas fait 90 minutes sans encombre).
  if (outEvents.length > 0) {
    const earliestExit = outEvents
      .map((s) => clampMinute(s.minute))
      .filter((m): m is number => m !== null)
      .sort((a, b) => a - b)[0];
    return earliestExit ?? 0;
  }
  return 0;
}

/**
 * Recalcule le tier de probabilité de but ET de passe décisive de chaque joueur (poste + forme),
 * à partir des buts/passes déjà enregistrés cette saison (match_goals) et d'une estimation
 * prudente des minutes individuelles (match_substitutions quand disponible, sinon proxy équipe
 * inchangé — voir resolvePlayerMatchMinutes ci-dessus).
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

  // Snapshot pré-journée : un match d'aujourd'hui (kickoff_at >= minuit UTC) ne doit jamais
  // contribuer au tier utilisé pour le scorer lui-même. Calculé une seule fois pour tout le run.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

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
        .select("id, home_team_id, away_team_id, kickoff_at")
        .eq("season_id", season.id)
        .eq("status", "finished")
        .lt("kickoff_at", todayStart.toISOString());

      const matchesByTeam = new Map<number, number[]>();
      const matchIds: number[] = [];
      for (const m of finishedMatches ?? []) {
        if (!matchesByTeam.has(m.home_team_id)) matchesByTeam.set(m.home_team_id, []);
        matchesByTeam.get(m.home_team_id)!.push(m.id);
        if (!matchesByTeam.has(m.away_team_id)) matchesByTeam.set(m.away_team_id, []);
        matchesByTeam.get(m.away_team_id)!.push(m.id);
        matchIds.push(m.id);
      }

      const goalsByPlayer = new Map<number, number>();
      const assistsByPlayer = new Map<number, number>();
      // matchIds provient exclusivement de finishedMatches, déjà filtré par status='finished' ET
      // kickoff_at < todayStart (Phase 2.2) — match_substitutions n'est donc jamais lu au-delà de
      // cet ensemble, ici comme pour match_goals juste en dessous.
      const subsByMatch = new Map<number, SubstitutionEvent[]>();
      if (matchIds.length > 0) {
        const { data: goals } = await supabase
          .from("match_goals")
          .select("player_id, assist_player_id")
          .in("match_id", matchIds);
        for (const g of goals ?? []) {
          if (g.player_id) goalsByPlayer.set(g.player_id, (goalsByPlayer.get(g.player_id) ?? 0) + 1);
          if (g.assist_player_id) assistsByPlayer.set(g.assist_player_id, (assistsByPlayer.get(g.assist_player_id) ?? 0) + 1);
        }

        const { data: subs } = await supabase
          .from("match_substitutions")
          .select("match_id, player_out_id, player_in_id, minute")
          .in("match_id", matchIds);
        for (const s of subs ?? []) {
          if (!subsByMatch.has(s.match_id)) subsByMatch.set(s.match_id, []);
          subsByMatch.get(s.match_id)!.push({ playerOutId: s.player_out_id, playerInId: s.player_in_id, minute: s.minute });
        }
      }

      const minutesPlayedByPlayer = new Map<number, number>();
      for (const p of players ?? []) {
        const teamMatchIds = matchesByTeam.get(p.team_id) ?? [];
        let total = 0;
        for (const matchId of teamMatchIds) {
          total += resolvePlayerMatchMinutes(p.id, subsByMatch.get(matchId) ?? []);
        }
        minutesPlayedByPlayer.set(p.id, total);
      }

      const scoringInputs: ScoringTierInput[] = (players ?? []).map((p) => {
        const minutesPlayed = minutesPlayedByPlayer.get(p.id) ?? 0;
        const goals = goalsByPlayer.get(p.id) ?? 0;
        return {
          playerId: p.id,
          position: p.position as Position,
          minutesPlayed,
          goalsPer90: minutesPlayed > 0 ? (goals * 90) / minutesPlayed : null,
        };
      });
      const assistInputs: AssistTierInput[] = (players ?? []).map((p) => {
        const minutesPlayed = minutesPlayedByPlayer.get(p.id) ?? 0;
        const assists = assistsByPlayer.get(p.id) ?? 0;
        return {
          playerId: p.id,
          position: p.position as Position,
          minutesPlayed,
          assistsPer90: minutesPlayed > 0 ? (assists * 90) / minutesPlayed : null,
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
