"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { spendMidseasonBonus } from "./actions";
import { buttonPrimary, buttonSecondary, card, input } from "@/lib/ui";

interface Player {
  id: string;
  username: string;
}

/** Affichée sur /leaderboard uniquement pour un joueur qui a un bonus mi-saison non utilisé et pas
 * encore expiré (voir page.tsx, `myBonus`). Confirmation en deux temps (pas de window.confirm,
 * incohérent avec le reste de l'appli) car l'action est irréversible et unique. */
export function MidseasonBonusCard({
  bonusId,
  amount,
  expiresAt,
  players,
}: {
  bonusId: number;
  amount: number;
  expiresAt: string;
  players: Player[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState(players[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (players.length === 0) return null;

  const target = players.find((p) => p.id === targetId);
  const deadline = new Date(expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  function handleConfirm() {
    if (!targetId) return;
    setError(null);
    startTransition(async () => {
      const res = await spendMidseasonBonus(targetId);
      if (res.error) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div
      className={`mb-8 border-reward ${card}`}
      style={{ background: "linear-gradient(135deg, rgba(217,154,24,0.16), rgba(217,154,24,0.03))" }}
      // key sur bonusId : si jamais un nouveau bonus (autre année) remplace l'ancien après refresh,
      // React réinitialise l'état local (select/confirmation) au lieu de garder une cible obsolète.
      key={bonusId}
    >
      <h2 className="text-lg font-bold text-reward">🏆 Bonus mi-saison</h2>
      <p className="mt-1 text-sm text-mute">
        Tu peux infliger <strong className="text-ink">-{amount} points</strong> au joueur de ton choix, avant le{" "}
        {deadline}.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setConfirming(false);
          }}
          disabled={isPending}
          className={`${input} sm:w-auto`}
        >
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.username}
            </option>
          ))}
        </select>

        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={isPending || !targetId} className={buttonPrimary}>
            Infliger -{amount} à {target?.username}
          </button>
        ) : (
          <>
            <button type="button" onClick={handleConfirm} disabled={isPending} className={buttonPrimary}>
              {isPending ? "..." : `Confirmer -${amount} à ${target?.username} ?`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={isPending} className={buttonSecondary}>
              Annuler
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-sm font-bold text-bad">{error}</p>}
    </div>
  );
}
