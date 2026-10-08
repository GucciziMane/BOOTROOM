"use client";

import { useEffect, useRef, useState } from "react";
import { submitSpecialQuizAnswer, type SubmitSpecialQuizAnswerResult } from "./actions";
import { getQuizSeasonLeaderboard, getPrivateQuizRanking, type SeasonLeaderboardRow } from "@/app/quiz/actions";
import { card } from "@/lib/ui";

export interface SpecialQuestionPublic {
  category: "score" | "player_career" | "trivia" | "vintage_jersey";
  difficulty: "easy" | "medium" | "hard";
  question: string;
  choices: string[];
}

interface InitialAnswer {
  position: number;
  isCorrect: boolean;
  points: number;
}

interface Props {
  token: string;
  title: string;
  introMessage: string;
  outroMessage: string;
  questions: SpecialQuestionPublic[];
  initialAnswers: InitialAnswer[];
  initialFinalScore: number | null;
  showPrivateRanking: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  score: "Score mythique",
  player_career: "Devine le joueur",
  trivia: "Culture générale",
  vintage_jersey: "Maillot vintage",
};

const DIFFICULTY_LABEL: Record<string, string> = { easy: "Facile", medium: "Moyen", hard: "Difficile" };

interface Feedback {
  isCorrect: boolean;
  correctIndex: number;
  explanation: string | null;
  points: number;
}

type AnswerState = "correct" | "wrong" | null;
type ResultPhase = "idle" | "hold" | "flying";

const HOLD_MS = 1100;
const FLY_MS = 420;
const TIMER_SECONDS = 20;
const TIMEOUT_SENTINEL = -1;

function deriveStreak(history: AnswerState[]): number {
  let streak = 0;
  for (const state of history) {
    if (state === "correct") streak++;
    else if (state === "wrong") streak = 0;
    else break;
  }
  return streak;
}

/**
 * Copie adaptée de src/app/quiz/QuizRunner.tsx pour le quiz surprise à usage unique (voir
 * actions.ts et supabase/migrations/0065_special_quiz.sql) — même mécanique de jeu (minuteur,
 * série, score) qu'un quiz dupliquée plutôt qu'un paramétrage du composant partagé : une erreur
 * introduite ici ne risque jamais d'affecter le quiz quotidien de tout le monde, et inversement.
 * Diffère surtout sur l'écran de fin : pas d'onglet "Aujourd'hui" (sans objet, ce quiz n'a pas de
 * date réelle), juste le message de fin personnalisé et le classement de saison habituel, dans
 * lequel ce score vient d'être compté.
 */
export function SpecialQuizRunner({
  title,
  introMessage,
  outroMessage,
  questions,
  initialAnswers,
  initialFinalScore,
  showPrivateRanking,
  token,
}: Props) {
  const totalQuestions = questions.length;
  const [history, setHistory] = useState<AnswerState[]>(() => {
    const arr: AnswerState[] = Array.from({ length: totalQuestions }, () => null);
    for (const a of initialAnswers) arr[a.position] = a.isCorrect ? "correct" : "wrong";
    return arr;
  });
  const [score, setScore] = useState(() => initialAnswers.reduce((sum, a) => sum + a.points, 0));
  const [position, setPosition] = useState(initialAnswers.length);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingFinalScore, setPendingFinalScore] = useState<number | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(initialFinalScore);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasonLeaderboard, setSeasonLeaderboard] = useState<SeasonLeaderboardRow[] | null>(null);
  const [privateRanking, setPrivateRanking] = useState<SeasonLeaderboardRow[] | null>(null);
  const [resultPhase, setResultPhase] = useState<ResultPhase>("idle");
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutFired = useRef(false);
  const deadlineRef = useRef(Date.now() + TIMER_SECONDS * 1000);
  const answeringLock = useRef(false);

  const streak = deriveStreak(history);

  useEffect(() => {
    if (finalScore != null) {
      getQuizSeasonLeaderboard().then(setSeasonLeaderboard);
      if (showPrivateRanking) getPrivateQuizRanking().then(setPrivateRanking);
    }
  }, [finalScore, showPrivateRanking]);

  useEffect(() => {
    if (resultPhase !== "flying") return;
    const t = setTimeout(() => {
      setResultPhase("idle");
      answeringLock.current = false;
      if (position === totalQuestions - 1 && pendingFinalScore != null) {
        setFinalScore(pendingFinalScore);
        return;
      }
      setSelected(null);
      setFeedback(null);
      setPosition((p) => p + 1);
    }, FLY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultPhase]);

  useEffect(() => () => {
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
  }, []);

  const lastTimerPosition = useRef(position);
  if (lastTimerPosition.current !== position) {
    lastTimerPosition.current = position;
    deadlineRef.current = Date.now() + TIMER_SECONDS * 1000;
    setTimeLeft(TIMER_SECONDS);
    timeoutFired.current = false;
  }

  useEffect(() => {
    if (selected !== null || finalScore != null) return;

    function tick() {
      const remainingMs = deadlineRef.current - Date.now();
      setTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0 && !timeoutFired.current) {
        timeoutFired.current = true;
        handleAnswer(TIMEOUT_SENTINEL);
      }
    }

    tick();
    const interval = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, selected, finalScore]);

  async function handleAnswer(choiceIndex: number) {
    if (answeringLock.current || submitting || selected !== null) return;
    answeringLock.current = true;
    setSelected(choiceIndex);
    setSubmitting(true);
    setError(null);

    const choiceIndexForServer = choiceIndex === TIMEOUT_SENTINEL ? null : choiceIndex;

    let res: SubmitSpecialQuizAnswerResult;
    try {
      res = await submitSpecialQuizAnswer(token, position, choiceIndexForServer);
    } catch {
      setSubmitting(false);
      setSelected(null);
      answeringLock.current = false;
      setError("Erreur réseau, réessaie.");
      return;
    }
    setSubmitting(false);

    if (res.error || res.correctIndex === undefined) {
      setError(res.error ?? "Erreur inconnue.");
      setSelected(null);
      answeringLock.current = false;
      return;
    }

    setFeedback({
      isCorrect: !!res.isCorrect,
      correctIndex: res.correctIndex,
      explanation: res.explanation ?? null,
      points: res.points ?? 0,
    });
    setScore((s) => s + (res.points ?? 0));
    setHistory((h) => {
      const next = [...h];
      next[position] = res.isCorrect ? "correct" : "wrong";
      return next;
    });
    if (res.finalScore != null) setPendingFinalScore(res.finalScore);

    setResultPhase("hold");
    holdTimeout.current = setTimeout(() => setResultPhase("flying"), HOLD_MS);
  }

  function skipHold() {
    if (resultPhase !== "hold") return;
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
    setResultPhase("flying");
  }

  if (finalScore != null) {
    return (
      <div className={`flex h-full flex-col overflow-y-auto ${card}`}>
        <h2 className="text-2xl font-bold">🎉 {title}</h2>
        <p className="mt-3 whitespace-pre-line text-mute">{outroMessage}</p>
        <p className="mt-4 text-lg">
          Score final : <strong className="text-good">{finalScore} pts</strong>
        </p>

        {showPrivateRanking && privateRanking && privateRanking.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-bold text-reward">Entre nous 🔒</h3>
            <ol className="space-y-2">
              {privateRanking.map((row, i) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between rounded-xl border border-reward bg-surface-raised p-3 text-sm"
                >
                  <span className="font-bold">
                    {i + 1}. {row.username}
                  </span>
                  <span className="font-bold text-reward">{row.totalScore} pts</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <h3 className="mb-2 mt-6 text-sm font-bold text-mute">Classement de saison 🏆</h3>
        {!seasonLeaderboard ? (
          <p className="text-sm text-mute">Chargement du classement...</p>
        ) : seasonLeaderboard.length === 0 ? (
          <p className="text-sm text-mute">Aucun score enregistré pour l&apos;instant.</p>
        ) : (
          <ol className="space-y-2">
            {seasonLeaderboard.map((row, i) => (
              <li
                key={row.userId}
                className="flex items-center justify-between rounded-xl border border-line bg-surface-raised p-3 text-sm"
              >
                <span className="font-bold">
                  {i + 1}. {row.username}
                </span>
                <span className="font-bold">
                  {row.totalScore} pts <span className="text-mute">({row.daysPlayed}j)</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  const q = questions[position];
  if (!q) {
    return (
      <div className={card}>
        <p className="text-mute">Ce quiz n&apos;est pas disponible.</p>
      </div>
    );
  }

  const progressPct = ((position + (selected !== null ? 1 : 0)) / totalQuestions) * 100;

  const resultBackground = feedback
    ? feedback.isCorrect
      ? "linear-gradient(135deg, var(--color-good), color-mix(in srgb, var(--color-good) 65%, black))"
      : "linear-gradient(135deg, var(--color-bad), color-mix(in srgb, var(--color-bad) 65%, black))"
    : undefined;

  const flyClass =
    resultPhase === "flying" ? (feedback?.isCorrect ? "animate-fly-right" : "animate-fly-left") : "";

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      {/* Message d'intro affiché une seule fois, avant la toute première question — jamais répété
          ensuite (même logique que l'avertissement du minuteur envisagé puis déplacé dans le chat,
          voir l'historique de QuizRunner.tsx : un message ponctuel ne doit pas revenir à chaque
          question). */}
      {position === 0 && selected === null && (
        <p className="shrink-0 whitespace-pre-line pb-2 text-center text-sm font-bold text-mute">
          {introMessage}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col justify-center pt-3">
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-x-3 top-0 bottom-0 rounded-[26px] shadow-lg"
            style={{ background: "linear-gradient(135deg, #131a30, #0b1020)" }}
          />

          <div
            key={position}
            onClick={skipHold}
            className={`animate-card-in relative flex flex-col overflow-hidden rounded-[28px] border border-paper/15 p-6 text-paper shadow-xl ${flyClass} ${
              resultPhase === "hold" ? "cursor-pointer" : ""
            }`}
            style={{
              background: "linear-gradient(135deg, #131a30, #0b1020)",
              willChange: "transform, opacity",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(217,154,24,0.4), transparent 70%)" }}
            />

            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 transition-opacity duration-300"
              style={{ background: resultBackground, opacity: resultPhase !== "idle" ? 1 : 0 }}
            />

            {feedback && (
              <div
                className={`absolute right-5 top-5 flex h-14 w-14 items-center justify-center rounded-full bg-paper text-2xl font-black shadow-lg ${
                  resultPhase !== "idle" ? "animate-pop-in" : ""
                }`}
                style={{ color: feedback.isCorrect ? "var(--color-good)" : "var(--color-bad)" }}
                aria-hidden
              >
                {feedback.isCorrect ? "✓" : "✕"}
              </div>
            )}

            <div className="relative flex flex-col gap-6">
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-paper/70">Score</p>
                    <p className="text-4xl font-black leading-none">{score}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {selected === null && (
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black tabular-nums transition-colors ${
                          timeLeft <= 3 ? "animate-pulse bg-bad text-paper" : "bg-paper/15 text-paper"
                        }`}
                        aria-label={`${timeLeft} secondes restantes`}
                      >
                        {timeLeft}
                      </span>
                    )}
                    {streak >= 2 && (
                      <span className="rounded-full bg-paper/15 px-3 py-1 text-sm font-bold">🔥 Série de {streak}</span>
                    )}
                  </div>
                </div>

                <p className="mt-4 text-xs font-bold uppercase tracking-wide text-paper/70">
                  Question {position + 1}/{totalQuestions} · {CATEGORY_LABEL[q.category] ?? q.category} ·{" "}
                  {DIFFICULTY_LABEL[q.difficulty]}
                </p>

                <p className="mt-4 text-xl font-bold leading-snug">{q.question}</p>
              </div>

              <div>
                <div className="grid grid-cols-2 gap-3">
                  {q.choices.map((choice, i) => {
                    const isSelected = selected === i;
                    const isCorrectChoice = !!feedback && i === feedback.correctIndex;
                    const isWrongSelected = !!feedback && isSelected && !feedback.isCorrect;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={selected !== null}
                        onClick={() => handleAnswer(i)}
                        className={`rounded-2xl px-4 py-4 text-center text-sm font-bold transition-colors ${
                          isCorrectChoice
                            ? "bg-good text-paper"
                            : isWrongSelected
                              ? "bg-bad text-paper"
                              : isSelected
                                ? `bg-paper text-[#10182a] ring-2 ring-reward ${submitting ? "animate-pulse" : ""}`
                                : "bg-paper/95 text-[#10182a] hover:bg-paper"
                        }`}
                      >
                        {choice}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-paper/25">
                  <div
                    className="h-full w-full origin-left rounded-full bg-paper transition-transform duration-300"
                    style={{ transform: `scaleX(${progressPct / 100})` }}
                  />
                </div>

                {error && <p className="mt-4 text-sm font-bold text-paper">{error}</p>}

                {feedback && (
                  <div className="mt-4 rounded-2xl bg-paper/10 p-4">
                    <p className="font-bold">
                      {feedback.isCorrect
                        ? `Bonne réponse ! +${feedback.points} pt${feedback.points > 1 ? "s" : ""}`
                        : "Mauvaise réponse."}
                    </p>
                    {feedback.explanation && <p className="mt-1 text-sm text-paper/80">{feedback.explanation}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex shrink-0 justify-center gap-2">
        {history.map((state, i) => (
          <span
            key={i}
            className={`h-2 w-2 rounded-full transition-colors ${
              state === "correct"
                ? "bg-good"
                : state === "wrong"
                  ? "bg-bad"
                  : i === position
                    ? "bg-accent"
                    : "border border-mute/40 bg-transparent"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
