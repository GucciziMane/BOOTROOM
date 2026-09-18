"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { saveBallonDorPrediction } from "./actions";

export interface NomineeOption {
  id: number;
  name: string;
  club_name: string;
  photo_url: string | null;
}

interface Props {
  nominees: NomineeOption[];
  username: string;
  avatarUrl: string | null;
}

// Mêmes dégradés métalliques que le podium du classement général (LeaderboardFilter.tsx) —
// réservés aux 3 premières places pour que "1/2/3" se reconnaisse au premier coup d'œil, comme
// partout ailleurs dans l'appli plutôt qu'une nouvelle convention propre à cette page.
const MEDAL_GRADIENT: Record<number, string> = {
  1:
    "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 45%, rgba(255,255,255,0) 62%), " +
    "linear-gradient(120deg, #fff6c8 0%, #ffd23f 16%, #e8a600 32%, #fff0a0 46%, #c9880a 62%, #a56a05 78%, #ffe066 90%, #8a6205 100%)",
  2:
    "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 45%, rgba(255,255,255,0) 62%), " +
    "linear-gradient(120deg, #ffffff 0%, #e4e9ee 16%, #c3ccd4 32%, #ffffff 46%, #a8b1ba 62%, #838d97 78%, #eef1f4 90%, #626b74 100%)",
  3:
    "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 45%, rgba(255,255,255,0) 62%), " +
    "linear-gradient(120deg, #eecba3 0%, #cd7f32 16%, #9c5a22 32%, #ecc190 46%, #7a4a20 62%, #5c3717 78%, #d69a5c 90%, #4a2b12 100%)",
};

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const RANK_POINTS: Record<number, number> = { 1: 50, 2: 30, 3: 20, 4: 20, 5: 20, 6: 10, 7: 10, 8: 10, 9: 10, 10: 10 };

// N'est monté par la page parente que si l'utilisateur n'a pas encore validé de pronostic ET que
// l'édition n'est pas verrouillée (voir page.tsx) : jamais affiché en lecture seule, donc pas
// besoin d'une prop "locked" ici — une fois enregistré (RLS, migration 0061 : plus aucune policy
// UPDATE), la page bascule elle-même sur BallonDorSubmittedList au prochain rendu.
export function BallonDorRunner({ nominees, username, avatarUrl }: Props) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [openRank, setOpenRank] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nomineeById = new Map(nominees.map((n) => [n.id, n]));
  const usedIds = new Set(Object.values(picks));

  function handlePick(rank: number, nomineeId: number) {
    setPicks((prev) => {
      const next = { ...prev };
      // Un même joueur ne peut être qu'à une seule place : le retirer de toute autre place avant
      // de l'assigner ici (jamais deux entrées pour le même nominee_id dans `picks`).
      for (const [r, id] of Object.entries(next)) {
        if (id === nomineeId && Number(r) !== rank) delete next[r];
      }
      next[String(rank)] = nomineeId;
      return next;
    });
    setOpenRank(null);
  }

  function handleClear(rank: number) {
    setPicks((prev) => {
      const next = { ...prev };
      delete next[String(rank)];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveBallonDorPrediction(picks);
    if (result.error) {
      setSaving(false);
      setError(result.error);
      return;
    }
    // Verrouillé dès l'enregistrement (plus aucune policy UPDATE) : on force le serveur à
    // relire l'état — la page bascule alors sur la liste en lecture seule (voir page.tsx).
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* En-tête : profil de l'utilisateur connecté, fixe (pas de suivi dynamique du scroll). */}
      <div className="flex flex-col items-center gap-2 py-2">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={72}
            height={72}
            className="h-[72px] w-[72px] rounded-full border-2 object-cover"
            style={{ borderColor: "var(--color-reward)" }}
          />
        ) : (
          <div
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 bg-cream text-2xl font-bold"
            style={{ borderColor: "var(--color-reward)" }}
          >
            {username.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="text-lg font-bold">{username}</span>
      </div>

      <p className="text-center text-sm text-mute">
        Place les 10 joueurs que tu penses voir au classement final du Ballon d&apos;Or. Une fois
        enregistré, ton pronostic ne pourra plus être modifié.
      </p>

      <div className="space-y-2">
        {RANKS.map((rank) => {
          const nomineeId = picks[String(rank)];
          const nominee = nomineeId != null ? nomineeById.get(nomineeId) : null;
          const isOpen = openRank === rank;
          const medalGradient = MEDAL_GRADIENT[rank];

          return (
            <div key={rank}>
              <button
                type="button"
                onClick={() => setOpenRank(isOpen ? null : rank)}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition-transform active:scale-[0.98] ${
                  nominee ? "border-transparent text-ink" : "border-dashed text-mute"
                }`}
                style={
                  nominee
                    ? medalGradient
                      ? { backgroundImage: medalGradient, backgroundSize: "55% 100%, 100% 100%" }
                      : { backgroundColor: "rgba(217,154,24,0.12)", borderColor: "var(--color-reward)" }
                    : { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(217,154,24,0.3)" }
                }
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-paper"
                  style={{ backgroundColor: "var(--color-reward)" }}
                >
                  {rank}
                </span>

                {nominee ? (
                  <>
                    {nominee.photo_url ? (
                      <Image
                        src={nominee.photo_url}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 shrink-0 rounded-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream text-sm font-bold">
                        {nominee.name.slice(0, 1)}
                      </div>
                    )}
                    <span className="min-w-0 flex-1" style={medalGradient ? { textShadow: "0 1px 4px rgba(0,0,0,0.65)" } : undefined}>
                      <span className="block truncate font-bold">{nominee.name.toUpperCase()}</span>
                      <span className="block truncate text-xs opacity-90">{nominee.club_name}</span>
                    </span>
                    <span
                      className="shrink-0 text-xs font-bold opacity-90"
                      style={medalGradient ? { textShadow: "0 1px 4px rgba(0,0,0,0.65)" } : undefined}
                    >
                      +{RANK_POINTS[rank]} pts
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-center font-bold">— ? —</span>
                )}
              </button>

              {isOpen && (
                <div className="mt-1 space-y-1 rounded-2xl border border-line bg-surface p-2">
                  {nominee && (
                    <button
                      type="button"
                      onClick={() => handleClear(rank)}
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-bad hover:bg-cream"
                    >
                      Vider cette place
                    </button>
                  )}
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {nominees
                      .filter((n) => !usedIds.has(n.id) || n.id === nomineeId)
                      .map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handlePick(rank, n.id)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-cream ${
                            n.id === nomineeId ? "bg-cream" : ""
                          }`}
                        >
                          {n.photo_url ? (
                            <Image
                              src={n.photo_url}
                              alt=""
                              width={36}
                              height={36}
                              className="h-9 w-9 shrink-0 rounded-full object-cover object-top"
                            />
                          ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream text-xs font-bold">
                              {n.name.slice(0, 1)}
                            </div>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{n.name.toUpperCase()}</span>
                            <span className="block truncate text-xs text-mute">{n.club_name}</span>
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-2">
        {error && <p className="mb-2 text-center text-sm text-bad">{error}</p>}
        {/* Doré plutôt que buttonPrimary (indigo générique) : seul bouton d'action de cette page,
            doit suivre son thème plutôt que la couleur d'accent du reste de l'appli. Mêmes classes
            structurelles que buttonPrimary (retour tactile, disabled...), juste la couleur remplacée. */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex w-full items-center justify-center rounded-xl px-5 py-2.5 font-bold text-[#2a1c02] transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
          style={{ backgroundColor: "var(--color-reward)" }}
        >
          {saving ? "Enregistrement..." : "Valider mon pronostic (définitif)"}
        </button>
      </div>
    </div>
  );
}
