"use client";

import { useRef, useState } from "react";
import { toggleGoalSubscription } from "./[matchId]/actions";

/** Cloche "but" d'un match — muette par défaut (voir migration match_goal_subscriptions), chacun
 * l'active indépendamment pour ce match précis ; live-tick ne notifie plus que les abonnés. Partagé
 * entre MatchPredictionCard (pronostic) et ScoreRow (affichage compact "en direct"). */
export function GoalBell({ matchId, initialSubscribed }: { matchId: number; initialSubscribed: boolean }) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  // Verrou synchrone (même pattern que answeringLock/sendingLock ailleurs dans l'app) : `subscribed`
  // lu par fermeture n'est à jour qu'au rendu suivant — une rafale de taps avant ce rendu pouvait
  // lire deux fois la même valeur et envoyer deux fois le même sens (ex: "abonner" au lieu
  // d'alterner abonner/désabonner), désynchronisant l'affichage de l'état réel en base.
  const toggling = useRef(false);

  async function toggle() {
    if (toggling.current) return;
    toggling.current = true;
    const next = !subscribed;
    setSubscribed(next); // optimiste : le retour serveur ne change quasiment jamais ce résultat
    try {
      const { error } = await toggleGoalSubscription(matchId, next);
      if (error) setSubscribed(!next);
    } catch {
      setSubscribed(!next);
    } finally {
      toggling.current = false;
    }
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
