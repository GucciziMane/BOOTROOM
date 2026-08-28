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
import { buttonPrimary, card } from "@/lib/ui";
import type { DailyQuestionPublic } from "@/lib/quiz/daily";

interface Props {
  questions: DailyQuestionPublic[];
  initialAnsweredCount: number;
  initialStreak: number;
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

export function QuizRunner({ questions, initialAnsweredCount, initialStreak, initialFinalScore }: Props) {
  const [position, setPosition] = useState(initialAnsweredCount);
  const [streak, setStreak] = useState(initialStreak);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingFinalScore, setPendingFinalScore] = useState<number | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(initialFinalScore);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [seasonLeaderboard, setSeasonLeaderboard] = useState<SeasonLeaderboardRow[] | null>(null);
  const [leaderboardView, setLeaderboardView] = useState<"today" | "season">("today");

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
    setStreak(res.streakAfter ?? 0);
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

  return (
    <div className={card}>
      <div className="mb-4 flex items-center justify-between text-xs font-bold text-mute">
        <span>
          Question {position + 1}/10 · {CATEGORY_LABEL[q.category] ?? q.category} · {DIFFICULTY_LABEL[q.difficulty]}
        </span>
        {streak >= 2 && <span className="text-good">🔥 Série de {streak}</span>}
      </div>

      {q.teamLogoUrl && (
        <Image src={q.teamLogoUrl} alt="" width={48} height={48} className="mx-auto mb-3 h-12 w-12 object-contain" />
      )}

      <p className="mb-4 text-lg font-bold">{q.question}</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              className={`rounded-xl border-2 p-3 text-left font-bold transition-colors ${
                isCorrectChoice
                  ? "border-good bg-good/10"
                  : isWrongSelected
                    ? "border-bad bg-bad/10"
                    : isSelected
                      ? "border-ink"
                      : "border-line hover:border-ink"
              }`}
            >
              {choice}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}

      {feedback && (
        <div className="mt-4">
          <p className={`font-bold ${feedback.isCorrect ? "text-good" : "text-bad"}`}>
            {feedback.isCorrect ? `Bonne réponse ! +${feedback.points} pt${feedback.points > 1 ? "s" : ""}` : "Mauvaise réponse."}
          </p>
          {feedback.explanation && <p className="mt-1 text-sm text-mute">{feedback.explanation}</p>}
          <button type="button" onClick={handleNext} className={`mt-3 ${buttonPrimary}`}>
            {position === 9 ? "Voir le résultat" : "Question suivante"}
          </button>
        </div>
      )}
    </div>
  );
}
