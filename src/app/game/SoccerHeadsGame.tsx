"use client";

import { useEffect, useRef, useState } from "react";
import {
  BALL_RADIUS,
  GOAL_HEIGHT,
  GROUND_Y,
  PLAYER_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createMatchState,
  resetPositions,
  stepMatch,
  type MatchState,
  type Side,
} from "@/lib/game/engine";
import { computeAiInput } from "@/lib/game/ai";
import { buttonPrimary, buttonSecondary, card } from "@/lib/ui";

export interface GameProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface Props {
  currentUser: GameProfile;
  otherProfiles: GameProfile[];
}

type Mode = "ai" | "local2p";
type Screen = "menu" | "playing" | "result";

const WIN_SCORE = 5;
const GOAL_PAUSE_MS = 1300;
// Un pas de temps borné (jamais plus de ~3 frames à 60fps d'un coup) : si l'onglet est resté en
// arrière-plan ou que le navigateur a sauté des frames, un dt énorme ferait traverser les murs ou
// le sol au ballon/aux joueurs en un seul pas plutôt que de simplement "rattraper" visuellement.
const MAX_DT = 1 / 20;

const SIDE_COLORS: Record<Side, string> = { left: "#3b82f6", right: "#ef4444" };

function loadAvatarImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Composant de jeu local (pas de serveur temps réel, voir l'échange avec l'utilisateur : 1v1 sur
 * le même écran, ou solo contre une IA simple) — mécanique physique originale, voir engine.ts. */
export function SoccerHeadsGame({ currentUser, otherProfiles }: Props) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [mode, setMode] = useState<Mode>("ai");
  const [opponentId, setOpponentId] = useState<string | null>(otherProfiles[0]?.id ?? null);
  const [score, setScore] = useState<Record<Side, number>>({ left: 0, right: 0 });
  const [winner, setWinner] = useState<Side | null>(null);
  const [goalBanner, setGoalBanner] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const matchRef = useRef<MatchState>(createMatchState());
  const modeRef = useRef<Mode>(mode);
  const avatarsRef = useRef<Record<Side, { img: HTMLImageElement | null; initial: string; color: string }>>({
    left: { img: null, initial: "?", color: SIDE_COLORS.left },
    right: { img: null, initial: "?", color: SIDE_COLORS.right },
  });
  const rafRef = useRef<number | null>(null);
  const pausedUntilRef = useRef<number>(0);

  const opponent = otherProfiles.find((p) => p.id === opponentId) ?? null;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Chargement des avatars (joueur courant à gauche, adversaire/IA à droite) à chaque lancement de
  // partie — pas au montage du composant, puisque l'adversaire en 2 joueurs locaux peut changer
  // d'un lancement à l'autre.
  async function loadAvatars() {
    const leftProfile = currentUser;
    const rightProfile: GameProfile | null = modeRef.current === "local2p" ? opponent : null;

    const [leftImg, rightImg] = await Promise.all([
      loadAvatarImage(leftProfile.avatarUrl),
      loadAvatarImage(rightProfile?.avatarUrl ?? null),
    ]);
    avatarsRef.current = {
      left: { img: leftImg, initial: leftProfile.username.slice(0, 1).toUpperCase(), color: SIDE_COLORS.left },
      right: {
        img: rightImg,
        // "IA", pas un slice(0,1) sur l'emoji robot : un emoji tient sur 2 unités UTF-16 (paire
        // de substitution), le couper au milieu affiche un glyphe de remplacement cassé plutôt
        // que la moitié d'un robot.
        initial: rightProfile ? rightProfile.username.slice(0, 1).toUpperCase() : "IA",
        color: SIDE_COLORS.right,
      },
    };
  }

  function startMatch() {
    matchRef.current = createMatchState();
    setScore({ left: 0, right: 0 });
    setWinner(null);
    setGoalBanner(false);
    pausedUntilRef.current = 0;
    loadAvatars().then(() => setScreen("playing"));
  }

  function backToMenu() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    setScreen("menu");
  }

  // Boucle de jeu : un seul effet, démarré/arrêté avec l'écran "playing" — la physique vit dans
  // matchRef (jamais le state React, pour ne pas re-render à 60fps), seuls score/fin de match/
  // bannière de but passent par setState, et seulement quand ils changent réellement.
  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = performance.now();

    function drawHead(side: Side, x: number, y: number) {
      if (!ctx) return;
      const avatar = avatarsRef.current[side];
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (avatar.img) {
        ctx.drawImage(avatar.img, x - PLAYER_RADIUS, y - PLAYER_RADIUS, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2);
      } else {
        ctx.fillStyle = avatar.color;
        ctx.fillRect(x - PLAYER_RADIUS, y - PLAYER_RADIUS, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2);
        ctx.fillStyle = "#fff";
        // Taille réduite pour "IA" (2 lettres) afin qu'il tienne dans le cercle comme une seule
        // initiale plus grande — même logique que le repli des pastilles sans avatar ailleurs
        // dans l'appli (voir LeaderboardFilter.tsx), juste adaptée à un éventuel libellé de 2 lettres.
        const fontSize = avatar.initial.length > 1 ? PLAYER_RADIUS * 0.62 : PLAYER_RADIUS;
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(avatar.initial, x, y + 2);
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = avatar.color;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    function draw() {
      if (!ctx) return;
      const state = matchRef.current;

      // Pelouse
      const grass = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
      grass.addColorStop(0, "#1f8a4c");
      grass.addColorStop(1, "#14642f");
      ctx.fillStyle = grass;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(WORLD_WIDTH / 2, 0);
      ctx.lineTo(WORLD_WIDTH / 2, GROUND_Y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(WORLD_WIDTH / 2, GROUND_Y, 55, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(WORLD_WIDTH, GROUND_Y);
      ctx.stroke();

      // Buts
      ctx.strokeStyle = "#f6f1e6";
      ctx.lineWidth = 5;
      ctx.strokeRect(-2, GROUND_Y - GOAL_HEIGHT, 2, GOAL_HEIGHT);
      ctx.strokeRect(WORLD_WIDTH, GROUND_Y - GOAL_HEIGHT, 2, GOAL_HEIGHT);

      // Joueurs (corps simple + tête avatar)
      for (const side of ["left", "right"] as Side[]) {
        const p = state.players[side];
        ctx.fillStyle = avatarsRef.current[side].color;
        ctx.fillRect(p.pos.x - 10, p.pos.y - 6, 20, 34);
        drawHead(side, p.pos.x, p.pos.y - PLAYER_RADIUS - 4);
      }

      // Ballon
      ctx.beginPath();
      ctx.arc(state.ball.pos.x, state.ball.pos.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#f6f1e6";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#211c14";
      ctx.stroke();
    }

    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 1000, MAX_DT);
      lastTime = now;
      const state = matchRef.current;

      if (modeRef.current === "ai") {
        state.players.right.input = computeAiInput("right", state);
      }

      if (!state.goalScoredSide && now >= pausedUntilRef.current) {
        const conceding = stepMatch(state, dt);
        if (conceding) {
          const scoringSide: Side = conceding === "left" ? "right" : "left";
          setScore({ ...state.score });
          if (state.score[scoringSide] >= WIN_SCORE) {
            setWinner(scoringSide);
            draw();
            setScreen("result");
            return;
          }
          setGoalBanner(true);
          pausedUntilRef.current = now + GOAL_PAUSE_MS;
          setTimeout(() => setGoalBanner(false), GOAL_PAUSE_MS - 200);
        }
      } else if (state.goalScoredSide && now >= pausedUntilRef.current) {
        resetPositions(state);
      }

      draw();
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [screen]);

  function setInput(side: Side, key: "left" | "right" | "jumpPressed", value: boolean) {
    matchRef.current.players[side].input[key] = value;
  }

  // onPointerDown/Up (pas onClick) : un bouton de direction doit agir tant qu'il est maintenu, pas
  // une seule fois par tap — voir engine.ts (stepPlayer lit `input.left/right` à chaque frame).
  function holdButton(side: Side, key: "left" | "right" | "jumpPressed") {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        setInput(side, key, true);
      },
      onPointerUp: () => setInput(side, key, false),
      onPointerLeave: () => setInput(side, key, false),
      onPointerCancel: () => setInput(side, key, false),
    };
  }

  if (screen === "menu") {
    return (
      <div className={`${card} space-y-6`}>
        <div>
          <h2 className="text-xl font-bold">Comment tu veux jouer ?</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("ai")}
              className={`rounded-2xl border-2 p-4 text-left font-bold transition-colors ${
                mode === "ai" ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              🤖 Solo vs IA
            </button>
            <button
              type="button"
              onClick={() => setMode("local2p")}
              disabled={otherProfiles.length === 0}
              className={`rounded-2xl border-2 p-4 text-left font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "local2p" ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              🎮 2 joueurs (même écran)
            </button>
          </div>
        </div>

        {mode === "local2p" && (
          <div>
            <h3 className="mb-2 text-sm font-bold text-mute">Qui joue en face ?</h3>
            <div className="grid grid-cols-2 gap-2">
              {otherProfiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpponentId(p.id)}
                  className={`truncate rounded-xl border-2 px-3 py-2 text-sm font-bold ${
                    opponentId === p.id ? "border-accent bg-accent-soft" : "border-line"
                  }`}
                >
                  {p.username}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm text-mute">
          Premier à {WIN_SCORE} buts. {mode === "ai" ? "Toi à gauche, l'IA à droite." : "Chacun ses boutons en bas de l'écran."}
        </p>

        <button type="button" onClick={startMatch} className={`w-full ${buttonPrimary}`}>
          Lancer le match
        </button>
      </div>
    );
  }

  if (screen === "result" && winner) {
    const winnerLabel = winner === "left" ? currentUser.username : mode === "ai" ? "L'IA" : (opponent?.username ?? "Joueur 2");
    return (
      <div className={`${card} space-y-4 text-center`}>
        <h2 className="text-2xl font-bold">🏆 {winnerLabel} gagne !</h2>
        <p className="text-lg">
          {score.left} – {score.right}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={startMatch} className={`flex-1 ${buttonPrimary}`}>
            Rejouer
          </button>
          <button type="button" onClick={backToMenu} className={`flex-1 ${buttonSecondary}`}>
            Changer de mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1 text-lg font-bold">
        <span>{currentUser.username}</span>
        <span className="tabular-nums">
          {score.left} – {score.right}
        </span>
        <span>{mode === "ai" ? "IA 🤖" : (opponent?.username ?? "Joueur 2")}</span>
      </div>

      <div className="relative overflow-hidden rounded-2xl shadow-md">
        <canvas
          ref={canvasRef}
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          className="block h-auto w-full touch-none"
          style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}` }}
        />
        {goalBanner && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-2xl bg-ink/80 px-6 py-3 text-3xl font-black text-paper">BUT ! ⚽</span>
          </div>
        )}
      </div>

      {/* Deux zones de contrôle (gauche/droite), chacune ◀ ▶ + saut — select-none/touch-none pour
          éviter la sélection de texte ou le défilement de la page pendant qu'on joue au doigt. */}
      <div className="grid grid-cols-2 gap-3 select-none">
        <div className="flex items-center justify-center gap-2">
          <button {...holdButton("left", "left")} className="h-14 w-14 touch-none rounded-2xl bg-ink text-2xl text-paper active:scale-95">
            ◀
          </button>
          <button {...holdButton("left", "jumpPressed")} className="h-14 w-14 touch-none rounded-2xl bg-accent text-xl text-paper active:scale-95">
            ⬆
          </button>
          <button {...holdButton("left", "right")} className="h-14 w-14 touch-none rounded-2xl bg-ink text-2xl text-paper active:scale-95">
            ▶
          </button>
        </div>
        {mode === "local2p" ? (
          <div className="flex items-center justify-center gap-2">
            <button {...holdButton("right", "left")} className="h-14 w-14 touch-none rounded-2xl bg-ink text-2xl text-paper active:scale-95">
              ◀
            </button>
            <button {...holdButton("right", "jumpPressed")} className="h-14 w-14 touch-none rounded-2xl bg-accent text-xl text-paper active:scale-95">
              ⬆
            </button>
            <button {...holdButton("right", "right")} className="h-14 w-14 touch-none rounded-2xl bg-ink text-2xl text-paper active:scale-95">
              ▶
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center text-sm text-mute">L&apos;IA se débrouille seule 🤖</div>
        )}
      </div>

      <button type="button" onClick={backToMenu} className={`${buttonSecondary} text-sm`}>
        Abandonner
      </button>
    </div>
  );
}
