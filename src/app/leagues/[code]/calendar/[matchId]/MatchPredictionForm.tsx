"use client";

import { useActionState, useState } from "react";
import { saveMatchPrediction, type SaveMatchPredictionState } from "./actions";
import { buttonPrimary, card, input } from "@/lib/ui";

interface PlayerOption {
  id: number;
  name: string;
}

interface ScoringInfo {
  matchExactScore: number;
  matchCorrectResultNoScore: number;
  scorerTierPoints: Record<number, number>;
  playerTier: Record<number, number>;
}

interface Props {
  leagueCode: string;
  matchId: number;
  homeTeamName: string;
  awayTeamName: string;
  homePlayers: PlayerOption[];
  awayPlayers: PlayerOption[];
  scoring: ScoringInfo;
  initial: {
    predictedHomeScore: number | null;
    predictedAwayScore: number | null;
    predictedScorerPlayerId: number | null;
  };
}

const initialState: SaveMatchPredictionState = { error: null, success: false };

export function MatchPredictionForm({
  leagueCode,
  matchId,
  homeTeamName,
  awayTeamName,
  homePlayers,
  awayPlayers,
  scoring,
  initial,
}: Props) {
  const [state, formAction, isPending] = useActionState(saveMatchPrediction, initialState);
  const [homeScore, setHomeScore] = useState(initial.predictedHomeScore != null ? String(initial.predictedHomeScore) : "");
  const [awayScore, setAwayScore] = useState(initial.predictedAwayScore != null ? String(initial.predictedAwayScore) : "");
  const [scorerId, setScorerId] = useState(
    initial.predictedScorerPlayerId != null ? String(initial.predictedScorerPlayerId) : ""
  );

  const scorer = scorerId ? [...homePlayers, ...awayPlayers].find((p) => p.id === Number(scorerId)) : undefined;
  const scorerPoints = scorer ? scoring.scorerTierPoints[scoring.playerTier[scorer.id]] ?? 0 : 0;

  return (
    <form action={formAction} className={`space-y-6 ${card}`}>
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="league_code" value={leagueCode} />

      <div className="flex items-center justify-center gap-4">
        <div className="text-center">
          <label className="mb-1 block text-sm font-bold text-mute">{homeTeamName}</label>
          <input
            type="number"
            name="predicted_home_score"
            min={0}
            placeholder="0"
            value={homeScore}
            onChange={(e) => setHomeScore(e.target.value)}
            className={`w-20 text-center text-xl font-bold ${input}`}
          />
        </div>
        <span className="pt-6 text-xl text-mute">–</span>
        <div className="text-center">
          <label className="mb-1 block text-sm font-bold text-mute">{awayTeamName}</label>
          <input
            type="number"
            name="predicted_away_score"
            min={0}
            placeholder="0"
            value={awayScore}
            onChange={(e) => setAwayScore(e.target.value)}
            className={`w-20 text-center text-xl font-bold ${input}`}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-mute">Un buteur (optionnel)</label>
        <select
          name="predicted_scorer_player_id"
          value={scorerId}
          onChange={(e) => setScorerId(e.target.value)}
          className={input}
        >
          <option value="">—</option>
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
      </div>

      <div className="rounded-xl border border-line bg-cream p-4 text-sm">
        <p className="mb-2 font-bold">Points en jeu</p>
        <ul className="space-y-1 text-mute">
          <li>
            Score exact : <strong className="text-ink">+{scoring.matchExactScore} pts</strong>
          </li>
          <li>
            Bon résultat sans le score exact :{" "}
            <strong className="text-ink">+{scoring.matchCorrectResultNoScore} pts</strong>
          </li>
          {scorer && (
            <li>
              {scorer.name} marque : <strong className="text-ink">+{scorerPoints} pts</strong>
            </li>
          )}
        </ul>
        {scorer && (
          <p className="mt-3 border-t border-line pt-3 font-bold">
            Total si score exact + {scorer.name} buteur :{" "}
            <span className="text-good">{scoring.matchExactScore + scorerPoints} pts</span>
          </p>
        )}
      </div>

      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.success && <p className="text-sm text-good">Pronostic enregistré.</p>}

      <button type="submit" disabled={isPending} className={buttonPrimary}>
        {isPending ? "Enregistrement..." : "Enregistrer mon pronostic"}
      </button>
    </form>
  );
}
