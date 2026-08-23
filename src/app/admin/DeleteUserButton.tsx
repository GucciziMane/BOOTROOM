"use client";

import { useActionState } from "react";
import { deleteUser, type DeleteUserState } from "./actions";

const initialState: DeleteUserState = { error: null, success: false };

export function DeleteUserButton({ userId, username }: { userId: string; username: string }) {
  const [state, formAction, isPending] = useActionState(deleteUser, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Supprimer définitivement le compte "${username}" ? Cette action est irréversible.`)) {
          e.preventDefault();
        }
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-xl border-2 border-bad px-3 py-1.5 text-sm font-bold text-bad transition-colors hover:bg-bad hover:text-paper disabled:opacity-50"
      >
        {isPending ? "Suppression..." : "Supprimer"}
      </button>
      {state.error && <span className="text-sm text-bad">{state.error}</span>}
    </form>
  );
}
