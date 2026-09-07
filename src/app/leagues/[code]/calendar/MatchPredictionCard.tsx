"use client";

import { useActionState, useOptimistic, useState, type CSSProperties } from "react";
import Image from "next/image";
import { saveMatchPrediction, toggleGoalSubscription, type SaveMatchPredictionState } from "./[matchId]/actions";
import { buttonPrimary, input } from "@/lib/ui";
import { applyResultOdds, predictedWinnerTeamId, type OddsTier, type ResultTierMultiplier } from "@/lib/scoring/points";
import { formatParisDateTime } from "@/lib/format-date";
import { LEAGUE_BACKGROUND } from "@/lib/league-background";
import {
  getLeagueCardStyle,
  leagueCardTeamTextClass,
  leagueCardTeamPlaceholderClass,
  LeagueCardBackground,
} from "@/lib/league-card-theme";

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
  /** Cloche "but" de ce match : muette par défaut, indépendante par joueur — voir live-tick, qui
   * ne notifie plus que les abonnés d'un match donné plutôt que tout le monde. */
  initialGoalSubscribed: boolean;
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
  initialGoalSubscribed,
  initial,
  leagueLabel,
  leagueColor,
  live,
}: Props) {
  const [goalSubscribed, setGoalSubscribed] = useState(initialGoalSubscribed);
  async function toggleBell() {
    const next = !goalSubscribed;
    setGoalSubscribed(next); // optimiste : le retour serveur ne change quasiment jamais ce résultat
    const { error } = await toggleGoalSubscription(matchId, next);
    if (error) setGoalSubscribed(!next);
  }

  const [state, formAction, isPending] = useActionState(saveMatchPrediction, initialState);
  // Affiché dès le tap plutôt qu'à la réponse du serveur (upsert + 3 revalidatePath, quelques
  // centaines de ms) : ça se sent instantané, et repasse tout seul à l'échec puisque optimisticSaved
  // suit state.success, qui lui ne bougera jamais si le serveur a refusé le pronostic.
  const [optimisticSaved, setOptimisticSaved] = useOptimistic(
    state.success,
    (_current: boolean, next: boolean) => next
  );
  async function optimisticFormAction(formData: FormData) {
    setOptimisticSaved(true);
    formAction(formData);
  }
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
  // d'un coup d'œil, sur toutes les cartes de match de l'appli (voir league-card-theme.tsx).
  const background = LEAGUE_BACKGROUND[leagueCode];
  const { theme, cardClassName, cardStyle, textFaint, textStrong } = getLeagueCardStyle(leagueCode, leagueColor);

  // Bouton assorti à l'image plutôt que le violet par défaut de l'appli, quand la compétition en
  // définit un — via des custom properties CSS (pas une couleur inline directe) pour que
  // hover:bg-[var(--btn-bg-hover)] reste réellement actif au survol (une inline style sur
  // background-color ne peut pas être re-surchargée par une règle :hover du stylesheet).
  const buttonClassName = background?.button
    ? buttonPrimary.replace("bg-accent", "bg-[var(--btn-bg)]").replace("hover:bg-accent-hover", "hover:bg-[var(--btn-bg-hover)]")
    : buttonPrimary;
  const buttonStyle = background?.button
    ? ({ "--btn-bg": background.button, "--btn-bg-hover": background.buttonHover ?? background.button } as CSSProperties)
    : undefined;

  if (locked) {
    const lockedScorer = [...homePlayers, ...awayPlayers].find((p) => p.id === initial.predictedScorerPlayerId);
    const lockedAssist = [...homePlayers, ...awayPlayers].find((p) => p.id === initial.predictedAssistPlayerId);
    return (
      <div className={cardClassName} style={cardStyle}>
        {background && <LeagueCardBackground image={background.image} light={theme === "light"} />}
        <p className={`relative mb-2 flex items-center justify-between text-xs font-bold ${textFaint}`}>
          <span>{formatParisDateTime(kickoffAt)}</span>
          <span className="flex items-center gap-2">
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
            <GoalBell subscribed={goalSubscribed} onToggle={toggleBell} />
          </span>
        </p>
        <div className="relative flex items-center justify-center gap-3">
          <TeamBadge name={homeTeamName} logoUrl={homeLogoUrl} theme={theme} />
          <span className={`text-lg font-bold ${textStrong}`}>
            {live ? (live.homeScore ?? 0) : (initial.predictedHomeScore ?? "–")}
            {" – "}
            {live ? (live.awayScore ?? 0) : (initial.predictedAwayScore ?? "–")}
          </span>
          <TeamBadge name={awayTeamName} logoUrl={awayLogoUrl} theme={theme} />
        </div>
        <p className={`relative mt-2 text-center text-xs ${textFaint}`}>
          {live && <span>Ton prono : {initial.predictedHomeScore ?? "–"}-{initial.predictedAwayScore ?? "–"} · </span>}
          {lockedScorer ? `Buteur : ${lockedScorer.name}` : initial.predictedHomeScore == null ? "Non pronostiqué" : "Sans buteur"}
          {lockedAssist && ` · Passeur : ${lockedAssist.name}`}
          {!live && " · Verrouillé"}
        </p>
      </div>
    );
  }

  return (
    <form action={optimisticFormAction} className={cardClassName} style={cardStyle}>
      {background && <LeagueCardBackground image={background.image} light={theme === "light"} />}
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="league_code" value={leagueCode} />
      <p className={`relative mb-2 flex items-center justify-between text-xs font-bold ${textFaint}`}>
        <span>{formatParisDateTime(kickoffAt)}</span>
        <span className="flex items-center gap-2">
          {leagueLabel && <span>{leagueLabel}</span>}
          <GoalBell subscribed={goalSubscribed} onToggle={toggleBell} />
        </span>
      </p>

      <div className="relative flex items-center justify-center gap-2">
        <TeamBadge name={homeTeamName} logoUrl={homeLogoUrl} theme={theme} />
        <input
          type="number"
          name="predicted_home_score"
          min={0}
          placeholder="0"
          value={homeScore}
          onChange={(e) => setHomeScore(e.target.value)}
          className={`w-12 text-center font-bold ${input}`}
        />
        <span className={textFaint}>–</span>
        <input
          type="number"
          name="predicted_away_score"
          min={0}
          placeholder="0"
          value={awayScore}
          onChange={(e) => setAwayScore(e.target.value)}
          className={`w-12 text-center font-bold ${input}`}
        />
        <TeamBadge name={awayTeamName} logoUrl={awayLogoUrl} theme={theme} />
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

      <p className={`relative mt-2 text-center text-xs ${textFaint}`}>
        Score exact +{exactScorePoints}pts{scorer ? ` · ${scorer.name} +${scorerPoints}pts` : ""}
        {assister ? ` · ${assister.name} +${assistPoints}pts` : ""}
      </p>

      <button
        type="submit"
        disabled={isPending}
        style={buttonStyle}
        className={`relative mt-2 w-full text-sm ${buttonClassName}`}
      >
        {optimisticSaved ? "Enregistré ✓" : "Enregistrer"}
      </button>
      {state.error && <p className="relative mt-1 text-center text-xs text-bad">{state.error}</p>}
    </form>
  );
}

/** Cloche "but" — muette par défaut (voir migration match_goal_subscriptions), chacun l'active
 * indépendamment pour ce match précis. type="button" : cette carte est parfois un <form>
 * (pronostic pas encore verrouillé), il ne faut surtout pas que le tap déclenche sa soumission. */
function GoalBell({ subscribed, onToggle }: { subscribed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={subscribed ? "Désactiver les notifs de but pour ce match" : "Être notifié des buts de ce match"}
      aria-pressed={subscribed}
      className="text-sm leading-none transition-transform active:scale-90"
    >
      {subscribed ? "🔔" : "🔕"}
    </button>
  );
}

function TeamBadge({ name, logoUrl, theme }: { name: string; logoUrl: string | null; theme: "none" | "dark" | "light" }) {
  return (
    <span className="flex w-20 flex-col items-center gap-1.5 text-center">
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <span className={`block h-10 w-10 shrink-0 rounded-full ${leagueCardTeamPlaceholderClass(theme)}`} />
      )}
      <span className={`text-[11px] font-bold leading-tight ${leagueCardTeamTextClass(theme)}`}>{name}</span>
    </span>
  );
}
