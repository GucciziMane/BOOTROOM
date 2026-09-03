"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { saveMatchPrediction, type SaveMatchPredictionState } from "./[matchId]/actions";
import { buttonPrimary, input } from "@/lib/ui";
import { applyResultOdds, predictedWinnerTeamId, type OddsTier, type ResultTierMultiplier } from "@/lib/scoring/points";
import { formatParisDateTime } from "@/lib/format-date";

interface PlayerOption {
  id: number;
  name: string;
}

interface Props {
  leagueCode: string;
  matchId: number;
  kickoffAt: string;
  homeTeamName: string;
  awayTeamName: string;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  homePlayers: PlayerOption[];
  awayPlayers: PlayerOption[];
  scoring: {
    matchExactScore: number;
    scorerTierPoints: Record<number, number>;
    playerTier: Record<number, number>;
    assistTierPoints: Record<number, number>;
    playerAssistTier: Record<number, number>;
  };
  resultOdds: {
    homeTeamId: number;
    awayTeamId: number;
    favoriteTeamId: number | null;
    tier: OddsTier | null;
    multiplierByTier: Record<number, ResultTierMultiplier>;
  };
  locked: boolean;
  initial: {
    predictedHomeScore: number | null;
    predictedAwayScore: number | null;
    predictedScorerPlayerId: number | null;
    predictedAssistPlayerId: number | null;
  };
  /** Affiché uniquement sur une vue qui mélange plusieurs championnats (ex: "prochaine journée"). */
  leagueLabel?: string;
  /** Idem : bordure de gauche colorée pour repérer le championnat d'un coup d'œil dans la grille. */
  leagueColor?: string;
}

const initialState: SaveMatchPredictionState = { error: null, success: false };

export function MatchPredictionCard({
  leagueCode,
  matchId,
  kickoffAt,
  homeTeamName,
  awayTeamName,
  homeLogoUrl,
  awayLogoUrl,
  homePlayers,
  awayPlayers,
  scoring,
  resultOdds,
  locked,
  initial,
  leagueLabel,
  leagueColor,
}: Props) {
  const [state, formAction, isPending] = useActionState(saveMatchPrediction, initialState);
  const [homeScore, setHomeScore] = useState(initial.predictedHomeScore != null ? String(initial.predictedHomeScore) : "");
  const [awayScore, setAwayScore] = useState(initial.predictedAwayScore != null ? String(initial.predictedAwayScore) : "");
  const [scorerId, setScorerId] = useState(
    initial.predictedScorerPlayerId != null ? String(initial.predictedScorerPlayerId) : ""
  );
  const [assistId, setAssistId] = useState(
    initial.predictedAssistPlayerId != null ? String(initial.predictedAssistPlayerId) : ""
  );

  const scorer = scorerId ? [...homePlayers, ...awayPlayers].find((p) => p.id === Number(scorerId)) : undefined;
  const scorerPoints = scorer ? (scoring.scorerTierPoints[scoring.playerTier[scorer.id]] ?? 0) : 0;
  const assister = assistId ? [...homePlayers, ...awayPlayers].find((p) => p.id === Number(assistId)) : undefined;
  const assistPoints = assister ? (scoring.assistTierPoints[scoring.playerAssistTier[assister.id]] ?? 0) : 0;
  const multiplierByTier = new Map(
    Object.entries(resultOdds.multiplierByTier).map(([tier, mult]) => [Number(tier) as OddsTier, mult])
  );
  const winnerTeamId =
    homeScore !== "" && awayScore !== ""
      ? predictedWinnerTeamId(Number(homeScore), Number(awayScore), resultOdds.homeTeamId, resultOdds.awayTeamId)
      : null;
  const exactScorePoints = applyResultOdds(
    scoring.matchExactScore,
    winnerTeamId,
    resultOdds.favoriteTeamId,
    resultOdds.tier,
    multiplierByTier
  );

  if (locked) {
    const lockedScorer = [...homePlayers, ...awayPlayers].find((p) => p.id === initial.predictedScorerPlayerId);
    const lockedAssist = [...homePlayers, ...awayPlayers].find((p) => p.id === initial.predictedAssistPlayerId);
    return (
      <div
        className="rounded-2xl border border-line bg-paper p-4 shadow-sm"
        style={leagueColor ? { borderLeftColor: leagueColor, borderLeftWidth: 4 } : undefined}
      >
        <p className="mb-2 flex items-center justify-between text-xs font-bold text-mute">
          <span>{formatParisDateTime(kickoffAt)}</span>
          {leagueLabel && <span>{leagueLabel}</span>}
        </p>
        <div className="flex items-center justify-center gap-3">
          <TeamBadge name={homeTeamName} logoUrl={homeLogoUrl} />
          <span className="text-lg font-bold">
            {initial.predictedHomeScore ?? "–"} – {initial.predictedAwayScore ?? "–"}
          </span>
          <TeamBadge name={awayTeamName} logoUrl={awayLogoUrl} />
        </div>
        <p className="mt-2 text-center text-xs text-mute">
          {lockedScorer ? `Buteur : ${lockedScorer.name}` : initial.predictedHomeScore == null ? "Non pronostiqué" : "Sans buteur"}
          {lockedAssist && ` · Passeur : ${lockedAssist.name}`}
          {" · "}Verrouillé
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-line bg-paper p-4 shadow-sm"
      style={leagueColor ? { borderLeftColor: leagueColor, borderLeftWidth: 4 } : undefined}
    >
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="league_code" value={leagueCode} />
      <p className="mb-2 flex items-center justify-between text-xs font-bold text-mute">
        <span>{formatParisDateTime(kickoffAt)}</span>
        {leagueLabel && <span>{leagueLabel}</span>}
      </p>

      <div className="flex items-center justify-center gap-2">
        <TeamBadge name={homeTeamName} logoUrl={homeLogoUrl} />
        <input
          type="number"
          name="predicted_home_score"
          min={0}
          placeholder="0"
          value={homeScore}
          onChange={(e) => setHomeScore(e.target.value)}
          className={`w-12 text-center font-bold ${input}`}
        />
        <span className="text-mute">–</span>
        <input
          type="number"
          name="predicted_away_score"
          min={0}
          placeholder="0"
          value={awayScore}
          onChange={(e) => setAwayScore(e.target.value)}
          className={`w-12 text-center font-bold ${input}`}
        />
        <TeamBadge name={awayTeamName} logoUrl={awayLogoUrl} />
      </div>

      <select
        name="predicted_scorer_player_id"
        value={scorerId}
        onChange={(e) => setScorerId(e.target.value)}
        className={`mt-3 text-sm ${input}`}
      >
        <option value="">Buteur (optionnel)</option>
        <optgroup label={homeTeamName}>
          {homePlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={awayTeamName}>
          {awayPlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>

      <select
        name="predicted_assist_player_id"
        value={assistId}
        onChange={(e) => setAssistId(e.target.value)}
        className={`mt-2 text-sm ${input}`}
      >
        <option value="">Passeur décisif (optionnel)</option>
        <optgroup label={homeTeamName}>
          {homePlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={awayTeamName}>
          {awayPlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>

      <p className="mt-2 text-center text-xs text-mute">
        Score exact +{exactScorePoints}pts{scorer ? ` · ${scorer.name} +${scorerPoints}pts` : ""}
        {assister ? ` · ${assister.name} +${assistPoints}pts` : ""}
      </p>

      <button type="submit" disabled={isPending} className={`mt-2 w-full text-sm ${buttonPrimary}`}>
        {isPending ? "..." : state.success ? "Enregistré ✓" : "Enregistrer"}
      </button>
      {state.error && <p className="mt-1 text-center text-xs text-bad">{state.error}</p>}
    </form>
  );
}

function TeamBadge({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className="flex w-20 flex-col items-center gap-1.5 text-center">
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <span className="block h-10 w-10 shrink-0 rounded-full bg-cream" />
      )}
      <span className="text-[11px] font-bold leading-tight">{name}</span>
    </span>
  );
}
