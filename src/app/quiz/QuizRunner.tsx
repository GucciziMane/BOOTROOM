"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  submitQuizAnswer,
  getQuizLeaderboard,
  getQuizSeasonLeaderboard,
  type LeaderboardRow,
  type SeasonLeaderboardRow,
  type SubmitAnswerResult,
} from "./actions";
import { card } from "@/lib/ui";
import type { DailyQuestionPublic } from "@/lib/quiz/daily";

interface InitialAnswer {
  position: number;
  isCorrect: boolean;
  points: number;
}

interface Props {
  questions: DailyQuestionPublic[];
  initialAnswers: InitialAnswer[];
  initialFinalScore: number | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  score: "Score mythique",
  player_career: "Devine le joueur",
  trivia: "Culture générale",
  vintage_jersey: "Maillot vintage",
  hidden_teammate: "Le coéquipier caché",
  guess_crest: "Devine le blason",
  guess_player_team: "Dans quel club ?",
  guess_match_score: "Score du match",
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

function deriveStreak(history: AnswerState[]): number {
  let streak = 0;
  for (const state of history) {
    if (state === "correct") streak++;
    else if (state === "wrong") streak = 0;
    else break;
  }
  return streak;
}

export function QuizRunner({ questions, initialAnswers, initialFinalScore }: Props) {
  // questions.length et non 10 en dur : un jour où une question dynamique n'a pas pu être générée,
  // le quiz du jour compte moins de 10 questions (cf. src/lib/quiz/daily.ts) — sans ça, la dernière
  // question ne serait jamais reconnue comme la fin du quiz.
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
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [seasonLeaderboard, setSeasonLeaderboard] = useState<SeasonLeaderboardRow[] | null>(null);
  const [leaderboardView, setLeaderboardView] = useState<"today" | "season">("today");
  const [resultPhase, setResultPhase] = useState<ResultPhase>("idle");
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Verrou synchrone : contrairement à `submitting` (state React, appliqué après un re-render),
  // ce ref est lu/écrit immédiatement. Sur mobile, un double-tap déclenche deux `handleAnswer`
  // avant que le re-render qui désactive les boutons n'ait eu lieu, envoyant deux réponses pour la
  // même position (la 2e violait la contrainte unique côté serveur et remontait une erreur brute).
  const answeringLock = useRef(false);

  const streak = deriveStreak(history);

  useEffect(() => {
    if (finalScore != null) {
      getQuizLeaderboard().then(setLeaderboard);
      getQuizSeasonLeaderboard().then(setSeasonLeaderboard);
    }
  }, [finalScore]);

  // Le résultat s'affiche un court instant sur la carte (couleur + icône), puis elle s'envole
  // (verte à droite si bonne réponse, rouge à gauche sinon) avant que la suivante n'apparaisse.
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

  async function handleAnswer(choiceIndex: number) {
    if (answeringLock.current || submitting || selected !== null) return;
    answeringLock.current = true;
    setSelected(choiceIndex);
    setSubmitting(true);
    setError(null);

    let res: SubmitAnswerResult;
    try {
      res = await submitQuizAnswer(position, choiceIndex);
    } catch {
      // Une exception (réseau, timeout serveur) ne doit jamais planter toute la page : on repasse
      // en état "pas encore répondu" pour permettre de retaper une réponse.
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
      <div className={card}>
        <h2 className="text-2xl font-bold">Quiz terminé ! 🎉</h2>
        <p className="mt-2 text-lg">
          Ton score du jour : <strong className="text-good">{finalScore} pts</strong>
        </p>

        <div className="mb-3 mt-6 flex gap-4 border-b border-line">
          <button
            type="button"
            onClick={() => setLeaderboardView("today")}
            className={`-mb-px border-b-2 px-1 py-2 text-sm font-bold ${
              leaderboardView === "today" ? "border-ink text-ink" : "border-transparent text-mute hover:text-ink"
            }`}
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={() => setLeaderboardView("season")}
            className={`-mb-px border-b-2 px-1 py-2 text-sm font-bold ${
              leaderboardView === "season" ? "border-ink text-ink" : "border-transparent text-mute hover:text-ink"
            }`}
          >
            Saison 🏆
          </button>
        </div>

        {leaderboardView === "today" ? (
          !leaderboard ? (
            <p className="text-sm text-mute">Chargement du classement...</p>
          ) : leaderboard.length === 0 ? (
            <p className="text-sm text-mute">Personne d&apos;autre n&apos;a encore terminé le quiz aujourd&apos;hui.</p>
          ) : (
            <ol className="space-y-2">
              {leaderboard.map((row, i) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between rounded-xl border border-line bg-cream p-3 text-sm"
                >
                  <span className="font-bold">
                    {i + 1}. {row.username}
                  </span>
                  <span className="font-bold">
                    {row.score} pts <span className="text-mute">({row.correctCount}/10)</span>
                  </span>
                </li>
              ))}
            </ol>
          )
        ) : !seasonLeaderboard ? (
          <p className="text-sm text-mute">Chargement du classement...</p>
        ) : seasonLeaderboard.length === 0 ? (
          <p className="text-sm text-mute">Aucun score enregistré pour l&apos;instant.</p>
        ) : (
          <ol className="space-y-2">
            {seasonLeaderboard.map((row, i) => (
              <li
                key={row.userId}
                className="flex items-center justify-between rounded-xl border border-line bg-cream p-3 text-sm"
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
        <p className="text-mute">Le quiz du jour n&apos;est pas encore disponible.</p>
      </div>
    );
  }

  const progressPct = ((position + (selected !== null ? 1 : 0)) / totalQuestions) * 100;

  // La couleur de résultat est une couche séparée qui s'estompe en fondu (opacity, géré par le
  // GPU) plutôt qu'une interpolation du dégradé lui-même (background) : animer "background"
  // force un repaint complet à chaque frame et fait saccader sur mobile.
  const resultBackground = feedback
    ? feedback.isCorrect
      ? "linear-gradient(135deg, var(--color-good), color-mix(in srgb, var(--color-good) 65%, black))"
      : "linear-gradient(135deg, var(--color-bad), color-mix(in srgb, var(--color-bad) 65%, black))"
    : undefined;

  const flyClass =
    resultPhase === "flying" ? (feedback?.isCorrect ? "animate-fly-right" : "animate-fly-left") : "";

  const nextLogoUrl = questions[position + 1]?.teamLogoUrl;

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Précharge le blason de la question suivante pendant qu'on répond à celle-ci (mêmes
          width/height que l'<Image> visible plus bas, pour que Next.js réutilise le même cache) :
          sinon il ne commence à charger qu'à l'affichage de la carte, avec un blanc visible le
          temps que ça arrive. */}
      {nextLogoUrl && (
        <Image src={nextLogoUrl} alt="" width={48} height={48} priority className="hidden" />
      )}

      <div className="relative pt-3">
        {/* La carte suivante occupe déjà tout l'espace derrière l'actuelle (même taille, juste
            décalée de quelques px vers le haut) : quand la carte du dessus s'envole, il y a
            toujours quelque chose derrière au lieu d'un vide le temps que la suivante arrive. */}
        <div
          aria-hidden
          className="absolute inset-x-3 top-0 bottom-0 rounded-[26px] shadow-lg"
          style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))" }}
        />

        <div
          key={position}
          onClick={skipHold}
          className={`animate-card-in relative overflow-hidden rounded-[28px] p-6 text-paper shadow-xl ${flyClass} ${
            resultPhase === "hold" ? "cursor-pointer" : ""
          }`}
          style={{
            background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))",
            willChange: "transform, opacity",
          }}
        >
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

          {/* position:relative pour que ce bloc peigne au-dessus de la couche de résultat
              ci-dessus : un élément absolute peint après le flux normal quel que soit son ordre
              dans le DOM, il faut donc que le contenu soit lui aussi "positionné" pour rester
              visible par-dessus. */}
          <div className="relative">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-paper/70">Score</p>
                <p className="text-4xl font-black leading-none">{score}</p>
              </div>
              {streak >= 2 && (
                <span className="rounded-full bg-paper/15 px-3 py-1 text-xs font-bold">🔥 Série de {streak}</span>
              )}
            </div>

            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-paper/70">
              Question {position + 1}/{totalQuestions} · {CATEGORY_LABEL[q.category] ?? q.category} ·{" "}
              {DIFFICULTY_LABEL[q.difficulty]}
            </p>

            {q.teamLogoUrl && (
              <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full bg-paper p-2 shadow">
                <Image src={q.teamLogoUrl} alt="" width={48} height={48} className="h-full w-full object-contain" />
              </div>
            )}

            <p className="mt-4 text-xl font-bold leading-snug">{q.question}</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
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
                    className={`rounded-2xl px-3 py-3 text-center text-sm font-bold transition-colors ${
                      isCorrectChoice
                        ? "bg-good text-paper"
                        : isWrongSelected
                          ? "bg-bad text-paper"
                          : isSelected
                            ? `bg-paper text-accent ring-2 ring-paper ${submitting ? "animate-pulse" : ""}`
                            : "bg-paper/95 text-accent hover:bg-paper"
                    }`}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-paper/25">
              <div
                className="h-full w-full origin-left rounded-full bg-paper transition-transform duration-300"
                style={{ transform: `scaleX(${progressPct / 100})` }}
              />
            </div>

            {error && <p className="mt-4 text-sm font-bold text-paper">{error}</p>}

            {feedback && (
              <div className="mt-4 rounded-2xl bg-paper/10 p-3">
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

      <div className="mt-5 flex justify-center gap-2">
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
