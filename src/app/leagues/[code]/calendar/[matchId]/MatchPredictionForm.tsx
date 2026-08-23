"use client";

import { useActionState, useState } from "react";
import { saveMatchPrediction, type SaveMatchPredictionState } from "./actions";
import { buttonPrimary, card, input } from "@/lib/ui";

interface PlayerOption {
  id: number;
  name: string;
}

interface Props {
  leagueCode: string;
  matchId: number;
  homeTeamName: string;
  awayTeamName: string;
  homePlayers: PlayerOption[];
  awayPlayers: PlayerOption[];
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
  initial,
}: Props) {
  const [state, formAction, isPending] = useActionState(saveMatchPrediction, initialState);
  const [homeScore, setHomeScore] = useState(initial.predictedHomeScore != null ? String(initial.predictedHomeScore) : "");
  const [awayScore, setAwayScore] = useState(initial.predictedAwayScore != null ? String(initial.predictedAwayScore) : "");

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
        <select name="predicted_scorer_player_id" defaultValue={initial.predictedScorerPlayerId ?? ""} className={input}>
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

      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {state.success && <p className="text-sm text-good">Pronostic enregistré.</p>}

      <button type="submit" disabled={isPending} className={buttonPrimary}>
        {isPending ? "Enregistrement..." : "Enregistrer mon pronostic"}
      </button>
    </form>
  );
}
