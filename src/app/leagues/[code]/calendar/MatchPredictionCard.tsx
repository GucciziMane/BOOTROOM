"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { saveMatchPrediction, type SaveMatchPredictionState } from "./[matchId]/actions";
import { buttonPrimary, input } from "@/lib/ui";
import { applyResultOdds, predictedWinnerTeamId, type OddsTier, type ResultTierMultiplier } from "@/lib/scoring/points";
import { formatParisDateTime } from "@/lib/format-date";
import { LEAGUE_BACKGROUND_IMAGE } from "@/lib/league-background";

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
  /** Présent uniquement si le match est actuellement en cours : score réel + minute, affichés à
   * la place du pronostic une fois le match verrouillé — voir /api/cron/live-tick. */
  live?: {
    homeScore: number | null;
    awayScore: number | null;
    liveClock: string | null;
  };
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
  live,
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

  // Habillage à part par championnat (image de fond fournie par l'utilisateur) plutôt qu'une
  // carte identique pour tous : demandé explicitement pour que chaque championnat se distingue
  // d'un coup d'œil dans "prochaine journée" comme dans le calendrier dédié.
  const backgroundImage = LEAGUE_BACKGROUND_IMAGE[leagueCode];
  const hasThemedBackground = !!backgroundImage;

  if (locked) {
    const lockedScorer = [...homePlayers, ...awayPlayers].find((p) => p.id === initial.predictedScorerPlayerId);
    const lockedAssist = [...homePlayers, ...awayPlayers].find((p) => p.id === initial.predictedAssistPlayerId);
    return (
      <div
        className={
          hasThemedBackground
            ? "relative overflow-hidden rounded-2xl p-4 shadow-md"
            : "rounded-2xl border border-line bg-paper p-4 shadow-sm"
        }
        style={!hasThemedBackground && leagueColor ? { borderLeftColor: leagueColor, borderLeftWidth: 4 } : undefined}
      >
        {hasThemedBackground && <LeagueThemedBackground image={backgroundImage} />}
        <p className={`relative mb-2 flex items-center justify-between text-xs font-bold ${hasThemedBackground ? "text-white/70" : "text-mute"}`}>
          <span>{formatParisDateTime(kickoffAt)}</span>
          {live ? (
            <span className="flex items-center gap-1 text-bad">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bad" />
              </span>
              {live.liveClock ?? "En direct"}
            </span>
          ) : (
            leagueLabel && <span>{leagueLabel}</span>
          )}
        </p>
        <div className="relative flex items-center justify-center gap-3">
          <TeamBadge name={homeTeamName} logoUrl={homeLogoUrl} light={hasThemedBackground} />
          <span className={`text-lg font-bold ${hasThemedBackground ? "text-white" : ""}`}>
            {live ? (live.homeScore ?? 0) : (initial.predictedHomeScore ?? "–")}
            {" – "}
            {live ? (live.awayScore ?? 0) : (initial.predictedAwayScore ?? "–")}
          </span>
          <TeamBadge name={awayTeamName} logoUrl={awayLogoUrl} light={hasThemedBackground} />
        </div>
        <p className={`relative mt-2 text-center text-xs ${hasThemedBackground ? "text-white/70" : "text-mute"}`}>
          {live && <span>Ton prono : {initial.predictedHomeScore ?? "–"}-{initial.predictedAwayScore ?? "–"} · </span>}
          {lockedScorer ? `Buteur : ${lockedScorer.name}` : initial.predictedHomeScore == null ? "Non pronostiqué" : "Sans buteur"}
          {lockedAssist && ` · Passeur : ${lockedAssist.name}`}
          {!live && " · Verrouillé"}
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className={
        hasThemedBackground
          ? "relative overflow-hidden rounded-2xl p-4 shadow-md"
          : "rounded-2xl border border-line bg-paper p-4 shadow-sm"
      }
      style={!hasThemedBackground && leagueColor ? { borderLeftColor: leagueColor, borderLeftWidth: 4 } : undefined}
    >
      {hasThemedBackground && <LeagueThemedBackground image={backgroundImage} />}
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="league_code" value={leagueCode} />
      <p className={`relative mb-2 flex items-center justify-between text-xs font-bold ${hasThemedBackground ? "text-white/70" : "text-mute"}`}>
        <span>{formatParisDateTime(kickoffAt)}</span>
        {leagueLabel && <span>{leagueLabel}</span>}
      </p>

      <div className="relative flex items-center justify-center gap-2">
        <TeamBadge name={homeTeamName} logoUrl={homeLogoUrl} light={hasThemedBackground} />
        <input
          type="number"
          name="predicted_home_score"
          min={0}
          placeholder="0"
          value={homeScore}
          onChange={(e) => setHomeScore(e.target.value)}
          className={`w-12 text-center font-bold ${input}`}
        />
        <span className={hasThemedBackground ? "text-white/70" : "text-mute"}>–</span>
        <input
          type="number"
          name="predicted_away_score"
          min={0}
          placeholder="0"
          value={awayScore}
          onChange={(e) => setAwayScore(e.target.value)}
          className={`w-12 text-center font-bold ${input}`}
        />
        <TeamBadge name={awayTeamName} logoUrl={awayLogoUrl} light={hasThemedBackground} />
      </div>

      <select
        name="predicted_scorer_player_id"
        value={scorerId}
        onChange={(e) => setScorerId(e.target.value)}
        className={`relative mt-3 text-sm ${input}`}
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
        className={`relative mt-2 text-sm ${input}`}
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

      <p className={`relative mt-2 text-center text-xs ${hasThemedBackground ? "text-white/70" : "text-mute"}`}>
        Score exact +{exactScorePoints}pts{scorer ? ` · ${scorer.name} +${scorerPoints}pts` : ""}
        {assister ? ` · ${assister.name} +${assistPoints}pts` : ""}
      </p>

      <button type="submit" disabled={isPending} className={`relative mt-2 w-full text-sm ${buttonPrimary}`}>
        {isPending ? "..." : state.success ? "Enregistré ✓" : "Enregistrer"}
      </button>
      {state.error && <p className="relative mt-1 text-center text-xs text-bad">{state.error}</p>}
    </form>
  );
}

function LeagueThemedBackground({ image }: { image: string }) {
  return (
    <>
      <Image src={image} alt="" fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" />
      {/* Overlay neutre (noir) plutôt que la teinte bleu nuit d'origine (pensée pour la seule
       * photo de stade C1) : chaque championnat garde sa propre couleur de marque en dessous
       * plutôt que de virer vers le bleu quel que soit son image de fond. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/55 to-black/80" />
    </>
  );
}

function TeamBadge({ name, logoUrl, light }: { name: string; logoUrl: string | null; light?: boolean }) {
  return (
    <span className="flex w-20 flex-col items-center gap-1.5 text-center">
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <span className={`block h-10 w-10 shrink-0 rounded-full ${light ? "bg-white/20" : "bg-cream"}`} />
      )}
      <span className={`text-[11px] font-bold leading-tight ${light ? "text-white" : ""}`}>{name}</span>
    </span>
  );
}
