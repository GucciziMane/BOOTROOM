"use client";

import { useActionState } from "react";
import { refreshScores, type RefreshScoresState } from "./actions";
import { buttonPrimary } from "@/lib/ui";

const initialState: RefreshScoresState = { error: null, success: false, summary: null };

export function RefreshScoresButton() {
  const [state, formAction, isPending] = useActionState(refreshScores, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={isPending} className={buttonPrimary}>
        {isPending ? "Actualisation en cours..." : "Actualiser les scores et les points"}
      </button>
      {isPending && (
        <span className="text-sm text-mute">Ça peut prendre jusqu&apos;à une minute ou deux, ne quitte pas la page.</span>
      )}
      {state.error && <span className="text-sm text-bad">{state.error}</span>}
      {state.success && state.summary && <span className="text-sm text-good">{state.summary}</span>}
    </form>
  );
}
