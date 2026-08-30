"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  submitQuizAnswer,
  getQuizLeaderboard,
  getQuizSeasonLeaderboard,
  type LeaderboardRow,
  type SeasonLeaderboardRow,
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
  const [history, setHistory] = useState<AnswerState[]>(() => {
    const arr: AnswerState[] = Array.from({ length: 10 }, () => null);
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

  const streak = deriveStreak(history);

  useEffect(() => {
    if (finalScore != null) {
      getQuizLeaderboard().then(setLeaderboard);
      getQuizSeasonLeaderboard().then(setSeasonLeaderboard);
    }
  }, [finalScore]);

  async function handleAnswer(choiceIndex: number) {
    if (submitting || selected !== null) return;
    setSelected(choiceIndex);
    setSubmitting(true);
    setError(null);
    const res = await submitQuizAnswer(position, choiceIndex);
    setSubmitting(false);

    if (res.error || res.correctIndex === undefined) {
      setError(res.error ?? "Erreur inconnue.");
      setSelected(null);
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
  }

  function handleNext() {
    if (position === 9 && pendingFinalScore != null) {
      setFinalScore(pendingFinalScore);
      return;
    }
    setSelected(null);
    setFeedback(null);
    setPosition((p) => p + 1);
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

  const progressPct = ((position + (selected !== null ? 1 : 0)) / 10) * 100;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="relative pt-3">
        {/* Pile de cartes : deux tranches qui dépassent derrière la carte active, décalées vers le haut
            (la carte principale a un padding-top qui les laisse apparaître au-dessus d'elle). */}
        <div
          aria-hidden
          className="absolute inset-x-8 top-0 h-10 rounded-t-[22px] opacity-20"
          style={{ background: "var(--color-accent)" }}
        />
        <div
          aria-hidden
          className="absolute inset-x-4 top-1.5 h-10 rounded-t-[24px] opacity-40"
          style={{ background: "var(--color-accent)" }}
        />

        <div
          key={position}
          className="animate-card-in relative overflow-hidden rounded-[28px] p-6 text-paper shadow-xl"
          style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))" }}
        >
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
            Question {position + 1}/10 · {CATEGORY_LABEL[q.category] ?? q.category} · {DIFFICULTY_LABEL[q.difficulty]}
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
                  className={`rounded-2xl px-3 py-3 text-center text-sm font-bold transition-all ${
                    isCorrectChoice
                      ? "bg-good text-paper"
                      : isWrongSelected
                        ? "bg-bad text-paper"
                        : isSelected
                          ? "bg-paper text-accent ring-2 ring-paper"
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
              className="h-full rounded-full bg-paper transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
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
              <button
                type="button"
                onClick={handleNext}
                className="mt-3 inline-flex items-center justify-center rounded-xl bg-paper px-5 py-2.5 font-bold text-accent transition-colors hover:bg-paper/90"
              >
                {position === 9 ? "Voir le résultat" : "Question suivante"}
              </button>
            </div>
          )}
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
