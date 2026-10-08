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

// Deux couleurs d'équipe par camp (maillot + short/liseré) — un chibi avec un maillot à deux tons
// lit tout de suite mieux comme "un joueur de foot" qu'un aplat uni.
const SIDE_COLORS: Record<Side, { jersey: string; jerseyDark: string; shorts: string }> = {
  left: { jersey: "#3b82f6", jerseyDark: "#1d4ed8", shorts: "#17224a" },
  right: { jersey: "#ef4444", jerseyDark: "#b91c1c", shorts: "#3a1212" },
};

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Bouton "doré biseauté" façon jeu mobile arcade (dégradé + liseré foncé + reflet + relief) —
// repris en CSS pour les contrôles tactiles, dans le même esprit que les boutons dessinés sur le
// canvas lui-même (voir drawScoreboard/drawGoal) plutôt que les boutons plats utilisés ailleurs
// dans l'appli : cet écran a son identité visuelle propre.
const gameButtonClass =
  "flex h-14 w-14 touch-none items-center justify-center rounded-2xl border-2 text-2xl font-black text-[#5a3410] transition-transform active:scale-95 active:translate-y-0.5";
const gameButtonStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #ffe08a 0%, #f6b83f 55%, #e8982a 100%)",
  borderColor: "#a85f14",
  boxShadow: "inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -3px 4px rgba(120,60,0,0.25), 0 3px 0 #a85f14",
};

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
  const avatarsRef = useRef<Record<Side, { img: HTMLImageElement | null; initial: string }>>({
    left: { img: null, initial: "?" },
    right: { img: null, initial: "?" },
  });
  // Phase de course par camp, accumulée proportionnellement à la vitesse (immobile = jambes
  // posées, en mouvement = balancier) — purement cosmétique, jamais lu par la physique (voir
  // engine.ts, qui n'a aucune idée de l'animation).
  const walkPhaseRef = useRef<Record<Side, number>>({ left: 0, right: 0 });
  // Dernier pas de temps calculé par la boucle de jeu, relu par drawPlayer pour l'animation de
  // course — purement pour l'affichage, jamais pour la physique elle-même (qui reçoit `dt`
  // directement en paramètre, voir tick()).
  const dtRef = useRef(1 / 60);
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
      left: { img: leftImg, initial: leftProfile.username.slice(0, 1).toUpperCase() },
      right: {
        img: rightImg,
        // "IA", pas un slice(0,1) sur l'emoji robot : un emoji tient sur 2 unités UTF-16 (paire
        // de substitution), le couper au milieu affiche un glyphe de remplacement cassé plutôt
        // que la moitié d'un robot.
        initial: rightProfile ? rightProfile.username.slice(0, 1).toUpperCase() : "IA",
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

    // --- Décor : ciel, tribunes, projecteurs — dessiné une fois par frame mais entièrement
    // procédural (aucune image externe) pour rester cohérent avec le reste, sans dépendre d'un
    // asset à charger ni se rapprocher visuellement d'un jeu existant précis. ---
    // Repères verticaux du décor — distincts et non chevauchants (contrairement à un premier jet
    // où la pelouse et les tribunes partageaient la même bande, la pelouse peinte PAR-DESSUS les
    // tribunes derrière elle) : ciel en haut, tribune juste en dessous, pelouse sur le reste.
    const SKY_BOTTOM = 90;
    const STAND_BOTTOM = 158;

    function drawStadium() {
      if (!ctx) return;
      const sky = ctx.createLinearGradient(0, 0, 0, SKY_BOTTOM);
      sky.addColorStop(0, "#5fb8ff");
      sky.addColorStop(1, "#bfe4ff");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WORLD_WIDTH, SKY_BOTTOM);

      // Nuages (quelques ellipses groupées, position fixe — décor, pas une simulation).
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const [cx, cy, scale] of [
        [90, 22, 0.7],
        [650, 18, 0.6],
        [420, 32, 0.5],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, 34 * scale, 14 * scale, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 24 * scale, cy + 4 * scale, 24 * scale, 11 * scale, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 22 * scale, cy + 5 * scale, 20 * scale, 10 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Tribune : une bande de gradins stylisés (rangées de blocs colorés) entre le ciel et la
      // pelouse, plutôt qu'une foule détaillée — même esprit "ambiance de stade" en beaucoup
      // moins de dessin.
      ctx.fillStyle = "#1b2240";
      ctx.fillRect(0, SKY_BOTTOM, WORLD_WIDTH, STAND_BOTTOM - SKY_BOTTOM);
      const standColors = ["#f6c945", "#f28c45", "#e8565f", "#f6c945", "#f28c45", "#e8565f"];
      const blockW = WORLD_WIDTH / standColors.length;
      const rowH = 15;
      const rows = Math.floor((STAND_BOTTOM - SKY_BOTTOM - 6) / rowH);
      for (let row = 0; row < rows; row++) {
        const rowY = SKY_BOTTOM + 6 + row * rowH;
        for (let i = 0; i < standColors.length; i++) {
          ctx.fillStyle = hexToRgba(standColors[(i + row) % standColors.length], 0.95 - row * 0.05);
          ctx.fillRect(i * blockW + 1, rowY, blockW - 2, rowH - 2);
        }
      }

      // Projecteurs aux coins, au-dessus de la tribune.
      for (const x of [34, WORLD_WIDTH - 34]) {
        ctx.strokeStyle = "#dfe6f2";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, SKY_BOTTOM);
        ctx.lineTo(x, 26);
        ctx.stroke();
        ctx.fillStyle = "#2c3560";
        ctx.beginPath();
        ctx.roundRect(x - 22, 8, 44, 20, 4);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = "#fff9d6";
          ctx.beginPath();
          ctx.arc(x - 15 + i * 10, 18, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function drawPitch() {
      if (!ctx) return;
      const turf = ctx.createLinearGradient(0, STAND_BOTTOM, 0, WORLD_HEIGHT);
      turf.addColorStop(0, "#36c27a");
      turf.addColorStop(1, "#1f9d5f");
      ctx.fillStyle = turf;
      ctx.fillRect(0, STAND_BOTTOM, WORLD_WIDTH, WORLD_HEIGHT - STAND_BOTTOM);

      // Bandes de tonte alternées — déco pure, aucun effet sur le jeu.
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 8; i += 2) {
        ctx.fillRect((WORLD_WIDTH / 8) * i, STAND_BOTTOM, WORLD_WIDTH / 8, WORLD_HEIGHT - STAND_BOTTOM);
      }

      // Bordure + marquage (rond central, ligne médiane, surfaces de réparation).
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 4;
      ctx.strokeRect(6, STAND_BOTTOM + 4, WORLD_WIDTH - 12, WORLD_HEIGHT - STAND_BOTTOM - 10);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(WORLD_WIDTH / 2, STAND_BOTTOM);
      ctx.lineTo(WORLD_WIDTH / 2, WORLD_HEIGHT);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(WORLD_WIDTH / 2, GROUND_Y, 48, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(6, GROUND_Y - 60, 90, 60);
      ctx.strokeRect(WORLD_WIDTH - 96, GROUND_Y - 60, 90, 60);
    }

    // But : montants + filet à motif nid d'abeille (dessiné comme une grille d'hexagones plutôt
    // qu'un simple quadrillage, pour la texture caractéristique d'un filet de ce genre de jeu —
    // esthétique générique, jamais une illustration ou un asset copié).
    function drawGoal(x: number, flip: boolean) {
      if (!ctx) return;
      const top = GROUND_Y - GOAL_HEIGHT;
      const depth = 34;
      const dir = flip ? -1 : 1;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, top, dir * depth, GOAL_HEIGHT);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.4;
      const hexR = 7;
      const hexW = hexR * 1.73;
      for (let row = -1; row * hexR * 1.5 < GOAL_HEIGHT + hexR; row++) {
        const rowY = top + row * hexR * 1.5;
        const offset = row % 2 === 0 ? 0 : hexW / 2;
        for (let col = -1; col * hexW < depth + hexW; col++) {
          const cx = x + dir * (col * hexW + offset);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const angle = (Math.PI / 3) * k + Math.PI / 6;
            const px = cx + hexR * Math.cos(angle);
            const py = rowY + hexR * Math.sin(angle);
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();

      // Montants (poteau avant, barre transversale, poteau arrière) par-dessus le filet.
      ctx.strokeStyle = "#f3f6fb";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 2);
      ctx.lineTo(x, top);
      ctx.lineTo(x + dir * depth, top);
      ctx.lineTo(x + dir * depth, GROUND_Y + 2);
      ctx.stroke();
      ctx.strokeStyle = "#2a63c7";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 2);
      ctx.lineTo(x, top);
      ctx.lineTo(x + dir * depth, top);
      ctx.lineTo(x + dir * depth, GROUND_Y + 2);
      ctx.stroke();
    }

    // Petit cadran à LED façon tableau d'affichage rétro — un chiffre fixe tient dans une police
    // monospace standard, pas besoin de dessiner de vrais segments pour que ça se lise comme un
    // compteur de score.
    function drawScorePanel(cx: number, value: number) {
      if (!ctx) return;
      const w = 58;
      const h = 44;
      ctx.fillStyle = "#15202e";
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, 4, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = "#0a0f17";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#4df07a";
      ctx.font = "bold 28px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(value).padStart(2, "0"), cx, 4 + h / 2 + 1);
    }

    function drawScoreboard(state: MatchState) {
      if (!ctx) return;
      const boardW = 170;
      const boardX = WORLD_WIDTH / 2 - boardW / 2;
      ctx.fillStyle = "#ebb33a";
      ctx.beginPath();
      ctx.roundRect(boardX, 0, boardW, 56, 10);
      ctx.fill();
      ctx.strokeStyle = "#8a5c15";
      ctx.lineWidth = 3;
      ctx.stroke();
      // Petits feux ronds aux coins, clin d'œil "panneau lumineux".
      for (const dx of [14, boardW - 14]) {
        ctx.fillStyle = "#e14b4b";
        ctx.beginPath();
        ctx.arc(boardX + dx, 12, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      drawScorePanel(boardX + 44, state.score.left);
      ctx.fillStyle = "#3a2a10";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("–", WORLD_WIDTH / 2, 27);
      drawScorePanel(boardX + boardW - 44, state.score.right);
    }

    function drawBall(x: number, y: number) {
      if (!ctx) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.closePath();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = "#f6f1e6";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#211c14";
      ctx.beginPath();
      ctx.moveTo(x, y - BALL_RADIUS * 0.55);
      for (let k = 0; k < 5; k++) {
        const angle = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        const px = x + Math.cos(angle) * BALL_RADIUS * 0.55;
        const py = y + Math.sin(angle) * BALL_RADIUS * 0.55;
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#211c14";
      ctx.stroke();
    }

    const BODY_W = 30;
    const BODY_H = 26;
    const LEG_LEN = 20;
    const LEG_W = 9;

    // Bonhomme "chibi" : grosse tête (l'avatar) sur un petit corps — jambes animées par un
    // balancier proportionnel à la vitesse horizontale (immobile = jambes jointes, en mouvement =
    // ciseaux), repliées vers l'arrière pendant un saut plutôt qu'un vrai cycle de course inutile
    // en l'air.
    function drawPlayer(side: Side, p: MatchState["players"][Side]) {
      if (!ctx) return;
      const colors = SIDE_COLORS[side];
      const { x, y } = p.pos;
      const speed = Math.abs(p.vel.x);
      walkPhaseRef.current[side] += speed * dtRef.current * 0.03;
      const phase = walkPhaseRef.current[side];

      ctx.save();
      ctx.translate(x, y);

      // Ombre au sol — ancre visuelle, utile surtout pendant un saut.
      const groundShadowScale = p.grounded ? 1 : Math.max(0.4, 1 - (GROUND_Y - y) / 220);
      ctx.fillStyle = "rgba(10,20,10,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, GROUND_Y - y + 4, 16 * groundShadowScale, 5 * groundShadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Jambes (deux capsules basculées en ciseaux, ou repliées en l'air).
      const swing = p.grounded ? Math.sin(phase) * (speed > 10 ? 0.55 : 0.08) : 0;
      const airTuck = p.grounded ? 0 : -0.45;
      for (const [side2, baseAngle] of [
        [1, swing + airTuck],
        [-1, -swing + airTuck],
      ] as const) {
        ctx.save();
        ctx.translate(side2 * 6, BODY_H / 2 - 4);
        ctx.rotate(baseAngle);
        ctx.fillStyle = colors.shorts;
        ctx.beginPath();
        ctx.roundRect(-LEG_W / 2, 0, LEG_W, LEG_LEN, 4);
        ctx.fill();
        ctx.fillStyle = "#1b1b1f";
        ctx.beginPath();
        ctx.roundRect(-LEG_W / 2 - 1, LEG_LEN - 6, LEG_W + 2, 8, 3);
        ctx.fill();
        ctx.restore();
      }

      // Bras (simples, un léger balancier opposé aux jambes pour la vie du perso).
      for (const side2 of [1, -1] as const) {
        ctx.save();
        ctx.translate(side2 * (BODY_W / 2 - 2), -BODY_H / 2 + 8);
        ctx.rotate(-side2 * swing * 0.6);
        ctx.fillStyle = colors.jersey;
        ctx.beginPath();
        ctx.roundRect(-4, 0, 8, 17, 4);
        ctx.fill();
        ctx.restore();
      }

      // Torse (maillot deux tons + short).
      ctx.fillStyle = colors.jersey;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2, -BODY_H, BODY_W, BODY_H, 8);
      ctx.fill();
      ctx.fillStyle = colors.jerseyDark;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2, -BODY_H, BODY_W, BODY_H * 0.4, 8);
      ctx.fill();
      ctx.fillStyle = colors.shorts;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2 + 2, -BODY_H * 0.18, BODY_W - 4, BODY_H * 0.3, 4);
      ctx.fill();

      ctx.restore();

      // Tête (proportion "chibi" : nettement plus grosse que le corps), avatar clippé dedans.
      drawHead(side, x, y - BODY_H - PLAYER_RADIUS * 0.75);
    }

    function drawHead(side: Side, x: number, y: number) {
      if (!ctx) return;
      const avatar = avatarsRef.current[side];
      const colors = SIDE_COLORS[side];
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (avatar.img) {
        ctx.drawImage(avatar.img, x - PLAYER_RADIUS, y - PLAYER_RADIUS, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2);
      } else {
        ctx.fillStyle = colors.jersey;
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
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = colors.jerseyDark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function draw() {
      if (!ctx) return;
      const state = matchRef.current;

      drawStadium();
      drawPitch();
      drawGoal(0, false);
      drawGoal(WORLD_WIDTH, true);

      for (const side of ["left", "right"] as Side[]) drawPlayer(side, state.players[side]);
      drawBall(state.ball.pos.x, state.ball.pos.y);

      drawScoreboard(state);
    }

    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 1000, MAX_DT);
      lastTime = now;
      dtRef.current = dt;
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
      <div className="flex items-center justify-between px-1 text-sm font-bold text-mute">
        <span className="truncate">🔵 {currentUser.username}</span>
        <span className="truncate">🔴 {mode === "ai" ? "IA" : (opponent?.username ?? "Joueur 2")}</span>
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
          éviter la sélection de texte ou le défilement de la page pendant qu'on joue au doigt.
          Boutons dorés biseautés (dégradé + liseré + reflet) plutôt que les boutons plats du reste
          de l'appli : l'écran de jeu a son identité propre, comme le tableau de score sur le
          canvas. */}
      <div className="grid grid-cols-2 gap-3 select-none">
        <div className="flex items-center justify-center gap-2">
          <button {...holdButton("left", "left")} style={gameButtonStyle} className={gameButtonClass}>
            ◀
          </button>
          <button {...holdButton("left", "jumpPressed")} style={gameButtonStyle} className={gameButtonClass}>
            ⬆
          </button>
          <button {...holdButton("left", "right")} style={gameButtonStyle} className={gameButtonClass}>
            ▶
          </button>
        </div>
        {mode === "local2p" ? (
          <div className="flex items-center justify-center gap-2">
            <button {...holdButton("right", "left")} style={gameButtonStyle} className={gameButtonClass}>
              ◀
            </button>
            <button {...holdButton("right", "jumpPressed")} style={gameButtonStyle} className={gameButtonClass}>
              ⬆
            </button>
            <button {...holdButton("right", "right")} style={gameButtonStyle} className={gameButtonClass}>
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
