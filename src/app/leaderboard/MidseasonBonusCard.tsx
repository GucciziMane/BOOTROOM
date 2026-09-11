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
 * incohérent avec le reste de l'appli) car l'action est irréversible et unique. `kind` distingue le
 * malus du top 3 (retire des points à la cible) du cadeau forcé du bottom 3 (en offre, sans coût
 * pour celui qui l'utilise) — même mécanique de sélection/confirmation, juste le sens qui change. */
export function MidseasonBonusCard({
  bonusId,
  amount,
  kind,
  expiresAt,
  players,
}: {
  bonusId: number;
  amount: number;
  kind: "malus" | "bonus";
  expiresAt: string;
  players: Player[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState(players[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (players.length === 0) return null;

  const isMalus = kind === "malus";
  const target = players.find((p) => p.id === targetId);
  const deadline = new Date(expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const sign = isMalus ? "-" : "+";
  const verb = isMalus ? "infliger" : "offrir";

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
      className={`mb-8 ${isMalus ? "border-reward" : "border-line"} ${card}`}
      style={{
        background: isMalus
          ? "linear-gradient(135deg, rgba(217,154,24,0.16), rgba(217,154,24,0.03))"
          : "linear-gradient(135deg, rgba(140,150,165,0.16), rgba(140,150,165,0.03))",
      }}
      // key sur bonusId : si jamais un nouveau bonus (autre année) remplace l'ancien après refresh,
      // React réinitialise l'état local (select/confirmation) au lieu de garder une cible obsolète.
      key={bonusId}
    >
      <h2 className={`text-lg font-bold ${isMalus ? "text-reward" : "text-ink"}`}>
        {isMalus ? "🏆 Bonus mi-saison" : "💩 Bonus mi-saison (punition du classement)"}
      </h2>
      <p className="mt-1 text-sm text-mute">
        Tu {isMalus ? "peux" : "dois"} {verb} <strong className="text-ink">{sign}{amount} points</strong>{" "}
        {isMalus ? "au" : "à un"} joueur de ton choix, avant le {deadline}.
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
            {isMalus ? "Infliger" : "Offrir"} {sign}{amount} à {target?.username}
          </button>
        ) : (
          <>
            <button type="button" onClick={handleConfirm} disabled={isPending} className={buttonPrimary}>
              {isPending ? "..." : `Confirmer ${sign}${amount} à ${target?.username} ?`}
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
