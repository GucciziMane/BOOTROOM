"use client";

import { useState } from "react";
import Image from "next/image";
import type { NomineeOption } from "./BallonDorRunner";

export interface SubmittedEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  picks: Record<string, number>;
  isMe: boolean;
}

interface Props {
  nominees: NomineeOption[];
  submitted: SubmittedEntry[];
}

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Affiché une fois qu'on a soi-même validé son pronostic (ou que l'édition est verrouillée) —
 * voir page.tsx et migration 0061 (RLS : pronostics des autres visibles seulement à cette
 * condition). Accordéon simple : un tap développe le classement complet de ce joueur. */
export function BallonDorSubmittedList({ nominees, submitted }: Props) {
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const nomineeById = new Map(nominees.map((n) => [n.id, n]));

  if (submitted.length === 0) {
    return <p className="text-center text-sm text-mute">Personne n&apos;a encore validé son pronostic.</p>;
  }

  return (
    <div className="space-y-2">
      {submitted.map((entry) => {
        const isOpen = openUserId === entry.userId;
        return (
          <div key={entry.userId}>
            <button
              type="button"
              onClick={() => setOpenUserId(isOpen ? null : entry.userId)}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-transform active:scale-[0.98]"
            >
              {entry.avatarUrl ? (
                <Image src={entry.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream text-sm font-bold">
                  {entry.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="min-w-0 flex-1 truncate font-bold">
                {entry.username}
                {entry.isMe ? " (toi)" : ""}
              </span>
              <span className="shrink-0 text-mute">{isOpen ? "▲" : "▼"}</span>
            </button>

            {isOpen && (
              <div className="mt-1 space-y-1 rounded-2xl border border-line bg-surface p-2">
                {RANKS.map((rank) => {
                  const nomineeId = entry.picks[String(rank)];
                  const nominee = nomineeId != null ? nomineeById.get(nomineeId) : null;
                  return (
                    <div key={rank} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-paper"
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
                              width={32}
                              height={32}
                              className="h-8 w-8 shrink-0 rounded-full object-cover object-top"
                            />
                          ) : (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream text-xs font-bold">
                              {nominee.name.slice(0, 1)}
                            </div>
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-bold">{nominee.name}</span>
                          <span className="shrink-0 truncate text-xs text-mute">{nominee.club_name}</span>
                        </>
                      ) : (
                        <span className="flex-1 text-sm text-mute">— ? —</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
