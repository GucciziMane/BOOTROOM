"use client";

import { useActionState, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import Image from "next/image";
import { saveSeasonPrediction, type SaveSeasonPredictionState } from "./actions";
import { buttonPrimary, card, input } from "@/lib/ui";

export interface PlayerOption {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
}

export interface TeamOption {
  id: number;
  name: string;
  logoUrl: string | null;
}

interface Props {
  leagueCode: string;
  seasonId: number;
  teams: TeamOption[];
  players: PlayerOption[];
  teamsCount: number;
  initial: {
    topScorerPlayerId: number | null;
    topAssistPlayerId: number | null;
    top3: Record<string, number>;
    bottom3: Record<string, number>;
    surpriseTeamId: number | null;
    flopTeamId: number | null;
    finalTeamAId: number | null;
    finalTeamBId: number | null;
    finalWinnerTeamId: number | null;
  };
}

/** Liste déroulante d'équipes avec logo (un <select> natif ne peut pas afficher d'image dans ses options). */
function TeamCombobox({
  teams,
  value,
  onChange,
  placeholder = "—",
}: {
  teams: TeamOption[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = teams.find((t) => t.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 text-left ${input}`}
      >
        {selected ? (
          <>
            {selected.logoUrl && (
              <Image src={selected.logoUrl} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
            )}
            <span className="truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-mute">{placeholder}</span>
        )}
      </button>

      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border-2 border-line bg-surface shadow-lg">
          <li>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-mute hover:bg-cream"
            >
              {placeholder}
            </button>
          </li>
          {teams.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(t.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink hover:bg-cream"
              >
                {t.logoUrl && <Image src={t.logoUrl} alt="" width={20} height={20} className="h-5 w-5 object-contain" />}
                <span className="truncate">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Sélection en 2 étapes : équipe (avec logo), puis joueur de cette équipe. */
function PlayerPicker({
  name,
  teams,
  players,
  defaultPlayerId,
}: {
  name: string;
  teams: TeamOption[];
  players: PlayerOption[];
  defaultPlayerId: number | null;
}) {
  const defaultPlayer = players.find((p) => p.id === defaultPlayerId) ?? null;
  const [teamId, setTeamId] = useState<number | "">(defaultPlayer?.teamId ?? "");
  const [playerId, setPlayerId] = useState<number | "">(defaultPlayerId ?? "");

  const teamPlayers = useMemo(
    () => players.filter((p) => p.teamId === teamId).sort((a, b) => a.name.localeCompare(b.name)),
    [players, teamId]
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      <TeamCombobox
        teams={teams}
        value={teamId}
        onChange={(id) => {
          setTeamId(id);
          setPlayerId("");
        }}
        placeholder="Équipe..."
      />
      <select
        value={playerId}
        onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : "")}
        disabled={!teamId}
        className={`${input} disabled:bg-surface-raised disabled:text-mute`}
      >
        <option value="">{teamId ? "Joueur..." : "Choisis d'abord l'équipe"}</option>
        {teamPlayers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input type="hidden" name={name} value={playerId} />
    </div>
  );
}

function TeamSelect({
  name,
  teams,
  defaultTeamId,
}: {
  name: string;
  teams: TeamOption[];
  defaultTeamId: number | null;
}) {
  const [teamId, setTeamId] = useState<number | "">(defaultTeamId ?? "");

  return (
    <>
      <TeamCombobox teams={teams} value={teamId} onChange={setTeamId} />
      <input type="hidden" name={name} value={teamId} />
    </>
  );
}

/** Finale (coupe à élimination directe) : 2 finalistes puis, seulement parmi eux, le vainqueur —
 * pas de sens de proposer top3/flop3 séparés d'un classement qui n'existe pas dans ce format. */
function FinalPredictionSection({
  teams,
  initialTeamAId,
  initialTeamBId,
  initialWinnerId,
}: {
  teams: TeamOption[];
  initialTeamAId: number | null;
  initialTeamBId: number | null;
  initialWinnerId: number | null;
}) {
  const [teamA, setTeamA] = useState<number | "">(initialTeamAId ?? "");
  const [teamB, setTeamB] = useState<number | "">(initialTeamBId ?? "");
  const [winner, setWinner] = useState<number | "">(initialWinnerId ?? "");

  const finalistIds = [teamA, teamB].filter((id): id is number => id !== "");
  // Dérivé plutôt que réinitialisé via un effet : si le vainqueur choisi n'est plus l'un des deux
  // finalistes actuels (changement d'équipe après coup), il redevient "aucun" directement au
  // rendu — pas besoin de resynchroniser un état séparé après coup.
  const winnerValue = winner !== "" && finalistIds.includes(winner) ? winner : "";

  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">Finale</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-bold text-mute">Finaliste 1</label>
          <TeamCombobox
            teams={teams.filter((t) => t.id !== teamB)}
            value={teamA}
            onChange={setTeamA}
            placeholder="Équipe..."
          />
          <input type="hidden" name="final_team_a_id" value={teamA} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold text-mute">Finaliste 2</label>
          <TeamCombobox
            teams={teams.filter((t) => t.id !== teamA)}
            value={teamB}
            onChange={setTeamB}
            placeholder="Équipe..."
          />
          <input type="hidden" name="final_team_b_id" value={teamB} />
        </div>
      </div>
      <div className="mt-4">
        <label className="mb-1 block text-sm font-bold text-mute">Vainqueur</label>
        <select
          value={winnerValue}
          onChange={(e) => setWinner(e.target.value ? Number(e.target.value) : "")}
          disabled={finalistIds.length < 2}
          className={`${input} disabled:bg-surface-raised disabled:text-mute`}
        >
          <option value="">{finalistIds.length < 2 ? "Choisis d'abord les 2 finalistes" : "Vainqueur..."}</option>
          {finalistIds.map((id) => (
            <option key={id} value={id}>
              {teams.find((t) => t.id === id)?.name}
            </option>
          ))}
        </select>
        <input type="hidden" name="final_winner_team_id" value={winnerValue} />
      </div>
    </section>
  );
}

const initialState: SaveSeasonPredictionState = { error: null, success: false };

export function SeasonPredictionForm({ leagueCode, seasonId, teams, players, teamsCount, initial }: Props) {
  const [state, formAction, isPending] = useActionState(saveSeasonPrediction, initialState);
  // Coupe à élimination directe : pas de flop3/équipe surprise/équipe flop (aucun sens sans
  // classement final), remplacés par un pronostic de finale — voir FinalPredictionSection.
  const isCup = leagueCode === "CL";
  // Confirmation affichée dès le tap plutôt qu'après l'aller-retour serveur — voir la même
  // technique sur MatchPredictionCard.
  const [optimisticSaved, setOptimisticSaved] = useOptimistic(
    state.success,
    (_current: boolean, next: boolean) => next
  );
  async function optimisticFormAction(formData: FormData) {
    setOptimisticSaved(true);
    formAction(formData);
  }

  return (
    <form action={optimisticFormAction} className={`space-y-8 ${card}`}>
      <input type="hidden" name="season_id" value={seasonId} />
      <input type="hidden" name="league_code" value={leagueCode} />

      <section>
        <h2 className="mb-3 text-lg font-bold">Buteur & passeur de la saison</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-bold text-mute">Meilleur buteur</label>
            <PlayerPicker
              name="top_scorer_player_id"
              teams={teams}
              players={players}
              defaultPlayerId={initial.topScorerPlayerId}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-mute">Meilleur passeur</label>
            <PlayerPicker
              name="top_assist_player_id"
              teams={teams}
              players={players}
              defaultPlayerId={initial.topAssistPlayerId}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Top 3 du classement</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((rank) => (
            <div key={rank}>
              <label className="mb-1 block text-sm font-bold text-mute">{rank === 1 ? "1er" : `${rank}e`}</label>
              <TeamSelect name={`top3_${rank}`} teams={teams} defaultTeamId={initial.top3[String(rank)] ?? null} />
            </div>
          ))}
        </div>
      </section>

      {isCup ? (
        <FinalPredictionSection
          teams={teams}
          initialTeamAId={initial.finalTeamAId}
          initialTeamBId={initial.finalTeamBId}
          initialWinnerId={initial.finalWinnerTeamId}
        />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-lg font-bold">Flop 3 du classement</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((rank) => (
                <div key={rank}>
                  <label className="mb-1 block text-sm font-bold text-mute">
                    {rank === 1 ? `${teamsCount}e (dernier)` : `${teamsCount - rank + 1}e`}
                  </label>
                  <TeamSelect
                    name={`bottom3_${rank}`}
                    teams={teams}
                    defaultTeamId={initial.bottom3[String(rank)] ?? null}
                  />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold">Équipe surprise & équipe flop</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-bold text-mute">Équipe surprise</label>
                <TeamSelect name="surprise_team_id" teams={teams} defaultTeamId={initial.surpriseTeamId} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-mute">Équipe flop</label>
                <TeamSelect name="flop_team_id" teams={teams} defaultTeamId={initial.flopTeamId} />
              </div>
            </div>
          </section>
        </>
      )}

      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      {optimisticSaved && !state.error && <p className="text-sm text-good">Pronostics enregistrés.</p>}

      <button type="submit" disabled={isPending} className={buttonPrimary}>
        {optimisticSaved && !state.error ? "Enregistré ✓" : isPending ? "Enregistrement..." : "Enregistrer mes pronostics"}
      </button>
    </form>
  );
}
