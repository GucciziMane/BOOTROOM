"use client";

import { useState } from "react";
import { toggleGoalSubscription } from "./[matchId]/actions";

/** Cloche "but" d'un match — muette par défaut (voir migration match_goal_subscriptions), chacun
 * l'active indépendamment pour ce match précis ; live-tick ne notifie plus que les abonnés. Partagé
 * entre MatchPredictionCard (pronostic) et ScoreRow (affichage compact "en direct"). */
export function GoalBell({ matchId, initialSubscribed }: { matchId: number; initialSubscribed: boolean }) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);

  async function toggle() {
    const next = !subscribed;
    setSubscribed(next); // optimiste : le retour serveur ne change quasiment jamais ce résultat
    const { error } = await toggleGoalSubscription(matchId, next);
    if (error) setSubscribed(!next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={subscribed ? "Désactiver les notifs de but pour ce match" : "Être notifié des buts de ce match"}
      aria-pressed={subscribed}
      className="text-sm leading-none transition-transform active:scale-90"
    >
      {subscribed ? "🔔" : "🔕"}
    </button>
  );
}
