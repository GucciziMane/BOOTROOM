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

// Contour sombre appliqué à CHAQUE forme du personnage (tête, torse, bras, jambes, ballon) — c'est
// ce liseré systématique façon "sticker" qui fait lire un dessin vectoriel comme un vrai personnage
// de jeu plutôt que des aplats de couleur juxtaposés (retour utilisateur : le premier jet sans
// contours cohérents faisait "fait maison").
const OUTLINE = "#241408";

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Bouton "doré biseauté" façon jeu mobile arcade (dégradé + liseré foncé + reflet + relief) —
// repris en CSS pour les contrôles tactiles, dans le même esprit que les boutons dessinés sur le
// canvas lui-même (voir drawScoreboard/drawGoal) plutôt que les boutons plats utilisés ailleurs
// dans l'appli : cet écran a son identité visuelle propre.
const gameButtonClass =
  "flex h-14 w-14 touch-none items-center justify-center rounded-2xl border-2 text-2xl font-black text-[#c0392b] transition-transform active:scale-95 active:translate-y-0.5";
const gameButtonStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #ffe08a 0%, #f6b83f 55%, #e8982a 100%)",
  borderColor: "#a85f14",
  boxShadow: "inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -3px 4px rgba(120,60,0,0.25), 0 3px 0 #a85f14",
};

// Panneau de contrôle : bande indigo à motif "tuilé" (plusieurs background-image empilés) derrière
// les boutons, façon pupitre d'arcade — plutôt que les boutons posés à nu sur le fond de la carte.
const controlBarStyle: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(180deg, #3e4d93 0%, #2c3870 100%), repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 26px), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 26px)",
};

interface HoldHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
}

// Bouton directionnel en triangle (découpé au clip-path) avec une pointe intérieure rouge, plutôt
// qu'un bouton carré avec un glyphe ◀/▶ — gagne beaucoup en ressemblance avec le jeu de référence
// pour un coût de code minime (pure CSS, aucun asset).
function TriangleButton({ dir, handlers }: { dir: "left" | "right"; handlers: HoldHandlers }) {
  const outerClip = dir === "left" ? "polygon(100% 0%, 100% 100%, 0% 50%)" : "polygon(0% 0%, 0% 100%, 100% 50%)";
  const innerClip = dir === "left" ? "polygon(100% 15%, 100% 85%, 25% 50%)" : "polygon(0% 15%, 0% 85%, 75% 50%)";
  return (
    <button
      {...handlers}
      aria-label={dir === "left" ? "Aller à gauche" : "Aller à droite"}
      className="relative flex h-14 w-14 touch-none items-center justify-center transition-transform active:scale-95 active:translate-y-0.5"
      style={{ clipPath: outerClip, background: "#7a3f0a" }}
    >
      {/* Liseré foncé visible tout autour (forme pleine légèrement plus grande, visible en bordure
          de la forme intérieure insettée) — même esprit que le contour systématique des personnages. */}
      <span
        className="absolute"
        style={{
          inset: 3,
          clipPath: outerClip,
          background: "linear-gradient(180deg, #ffe08a 0%, #f6b83f 55%, #e8982a 100%)",
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.6), inset 0 -3px 4px rgba(120,60,0,0.25)",
        }}
      />
      <span className="absolute inset-0" style={{ clipPath: innerClip, background: "#c0392b", margin: 2 }} />
    </button>
  );
}

// Teints de peau et couleurs de cheveux pour les visages dessinés (voir drawHead) — une vraie
// photo de profil ronde jurait avec le reste du personnage dessiné à la main (retour utilisateur
// explicite) ; un visage cartoon s'intègre au style, l'identité du joueur restant lisible via son
// pseudo déjà affiché au-dessus du terrain. Choisi par hash du pseudo pour rester stable d'une
// partie à l'autre sans dépendre d'une photo.
const SKIN_TONES = ["#f2c18c", "#e8a46d", "#c9834f", "#8a5a34"];
const HAIR_COLORS = ["#2b1708", "#4a2d12", "#171310", "#6b3d1a", "#000000"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

interface CharacterStyle {
  skin: string;
  hair: string;
  number: string;
}

function characterStyleFor(label: string): CharacterStyle {
  const h = hashString(label);
  return {
    skin: SKIN_TONES[h % SKIN_TONES.length],
    hair: HAIR_COLORS[Math.floor(h / SKIN_TONES.length) % HAIR_COLORS.length],
    number: label.slice(0, 1).toUpperCase(),
  };
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
  const avatarsRef = useRef<Record<Side, CharacterStyle>>({
    left: characterStyleFor(currentUser.username),
    right: characterStyleFor("IA"),
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

  // Style de personnage (teint/cheveux/numéro) à chaque lancement de partie — pas au montage du
  // composant, puisque l'adversaire en 2 joueurs locaux peut changer d'un lancement à l'autre.
  function rollCharacterStyles() {
    const rightProfile: GameProfile | null = modeRef.current === "local2p" ? opponent : null;
    avatarsRef.current = {
      left: characterStyleFor(currentUser.username),
      right: characterStyleFor(rightProfile?.username ?? "IA"),
    };
  }

  function startMatch() {
    matchRef.current = createMatchState();
    setScore({ left: 0, right: 0 });
    setWinner(null);
    setGoalBanner(false);
    pausedUntilRef.current = 0;
    rollCharacterStyles();
    setScreen("playing");
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
      // Palette "bonbon" (teal/lavande/jaune/corail) plutôt que doré/orangé uni — plus proche de
      // l'ambiance vive et colorée du jeu de référence, sans reprendre sa scène précise (manège +
      // toboggans) qui est une composition de niveau trop spécifique pour être redessinée ici.
      const standColors = ["#4fd1c5", "#b48ce0", "#ffd166", "#ff6f91", "#4fd1c5", "#b48ce0"];
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

    // Terrain rose façon "plateau" avec une bordure plus foncée en bas (suggère une légère
    // épaisseur/profondeur 3D, comme un plateau vu légèrement de dessus) plutôt qu'une simple
    // pelouse verte à plat — coloris "bonbon" demandé pour coller à l'esprit du jeu de référence,
    // entièrement reconstruit en formes/dégradés (aucun asset importé).
    const PITCH_EDGE_H = 14;

    function drawPitch() {
      if (!ctx) return;
      const top = STAND_BOTTOM;
      const h = WORLD_HEIGHT - top;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, top, WORLD_WIDTH, h, [18, 18, 0, 0]);
      ctx.clip();

      const turf = ctx.createLinearGradient(0, top, 0, WORLD_HEIGHT);
      turf.addColorStop(0, "#ff9fd6");
      turf.addColorStop(1, "#f45fae");
      ctx.fillStyle = turf;
      ctx.fillRect(0, top, WORLD_WIDTH, h);

      // Bandes de tonte alternées — déco pure, aucun effet sur le jeu.
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let i = 0; i < 8; i += 2) {
        ctx.fillRect((WORLD_WIDTH / 8) * i, top, WORLD_WIDTH / 8, h);
      }

      // Bordure inférieure plus foncée : lit comme le "chant" du plateau, pas comme la pelouse.
      ctx.fillStyle = "#d1298a";
      ctx.fillRect(0, WORLD_HEIGHT - PITCH_EDGE_H, WORLD_WIDTH, PITCH_EDGE_H);

      // Marquage (rond central, ligne médiane, surfaces de réparation).
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 4;
      ctx.strokeRect(6, top + 4, WORLD_WIDTH - 12, h - PITCH_EDGE_H - 8);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(WORLD_WIDTH / 2, top);
      ctx.lineTo(WORLD_WIDTH / 2, WORLD_HEIGHT - PITCH_EDGE_H);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(WORLD_WIDTH / 2, GROUND_Y, 48, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(6, GROUND_Y - 60, 90, 60);
      ctx.strokeRect(WORLD_WIDTH - 96, GROUND_Y - 60, 90, 60);
      ctx.restore();
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

    // Cadran à chiffres blancs sur fond marine (plutôt qu'un LCD vert) — plus proche du tableau
    // d'affichage du jeu de référence, toujours dessiné en formes pures (aucun asset importé).
    function drawScorePanel(cx: number, value: number) {
      if (!ctx) return;
      const w = 56;
      const h = 42;
      ctx.fillStyle = "#1b2338";
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, 7, w, h, 7);
      ctx.fill();
      ctx.strokeStyle = "#0a0f1c";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(value).padStart(2, "0"), cx, 7 + h / 2 + 1);
    }

    function drawScoreboard(state: MatchState) {
      if (!ctx) return;
      const boardW = 184;
      const boardH = 58;
      const boardX = WORLD_WIDTH / 2 - boardW / 2;

      const plaque = ctx.createLinearGradient(0, 0, 0, boardH);
      plaque.addColorStop(0, "#f7c856");
      plaque.addColorStop(1, "#d6930f");
      ctx.fillStyle = plaque;
      ctx.beginPath();
      ctx.roundRect(boardX, 0, boardW, boardH, 10);
      ctx.fill();
      ctx.strokeStyle = "#8a5c15";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Piliers ambrés de part et d'autre (façon montants de panneau lumineux).
      ctx.fillStyle = "#b9711a";
      for (const bx of [boardX + 4, boardX + boardW - 14]) {
        ctx.beginPath();
        ctx.roundRect(bx, 5, 10, boardH - 10, 3);
        ctx.fill();
      }

      // Petits feux ronds aux coins, clin d'œil "panneau lumineux".
      for (const dx of [16, boardW - 16]) {
        ctx.fillStyle = "#e14b4b";
        ctx.beginPath();
        ctx.arc(boardX + dx, 11, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#7a1f1f";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      drawScorePanel(boardX + 50, state.score.left);
      ctx.fillStyle = "#5a3410";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("–", WORLD_WIDTH / 2, 30);
      drawScorePanel(boardX + boardW - 50, state.score.right);
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
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = OUTLINE;
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

      // Jambes (deux capsules basculées en ciseaux, ou repliées en l'air) + chaussette blanche +
      // crampon, chacune avec son propre contour — pas un aplat de couleur juxtaposé.
      const swing = p.grounded ? Math.sin(phase) * (speed > 10 ? 0.55 : 0.08) : 0;
      const airTuck = p.grounded ? 0 : -0.45;
      ctx.lineJoin = "round";
      for (const [side2, baseAngle] of [
        [1, swing + airTuck],
        [-1, -swing + airTuck],
      ] as const) {
        ctx.save();
        ctx.translate(side2 * 6, BODY_H / 2 - 4);
        ctx.rotate(baseAngle);
        ctx.fillStyle = colors.shorts;
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-LEG_W / 2, 0, LEG_W, LEG_LEN, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.roundRect(-LEG_W / 2, LEG_LEN - 10, LEG_W, 4, 2);
        ctx.fill();
        ctx.fillStyle = "#1b1b1f";
        ctx.beginPath();
        ctx.roundRect(-LEG_W / 2 - 1, LEG_LEN - 6, LEG_W + 2, 8, 3);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Bras (simples, un léger balancier opposé aux jambes pour la vie du perso) + manchette.
      for (const side2 of [1, -1] as const) {
        ctx.save();
        ctx.translate(side2 * (BODY_W / 2 - 2), -BODY_H / 2 + 8);
        ctx.rotate(-side2 * swing * 0.6);
        ctx.fillStyle = colors.jersey;
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-4, 0, 8, 17, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.roundRect(-4, 12, 8, 4, 2);
        ctx.fill();
        ctx.restore();
      }

      // Torse (maillot deux tons + col) + short avec liseré blanc — un contour unique autour du
      // torse entier (dessiné après les deux teintes, pour ne pas le couper par la bande sombre).
      ctx.fillStyle = colors.jersey;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2, -BODY_H, BODY_W, BODY_H, 8);
      ctx.fill();
      ctx.fillStyle = colors.jerseyDark;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2, -BODY_H, BODY_W, BODY_H * 0.4, 8);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2, -BODY_H, BODY_W, BODY_H, 8);
      ctx.stroke();
      // Numéro/initiale sur le maillot — identifie le joueur sans recourir à une photo.
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(avatarsRef.current[side].number, 0, -BODY_H * 0.62);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.roundRect(-6, -BODY_H - 1, 12, 5, 2);
      ctx.fill();
      ctx.fillStyle = colors.shorts;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2 + 2, -BODY_H * 0.18, BODY_W - 4, BODY_H * 0.3, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(-2, -BODY_H * 0.18, 4, BODY_H * 0.3);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-BODY_W / 2 + 2, -BODY_H * 0.18, BODY_W - 4, BODY_H * 0.3, 4);
      ctx.stroke();

      ctx.restore();

      // Tête (proportion "chibi" : nettement plus grosse que le corps), visage dessiné.
      drawHead(side, x, y - BODY_H - PLAYER_RADIUS * 0.75);
    }

    // Visage cartoon (teint + cheveux + sourcils/yeux + bandeau couleur d'équipe) plutôt qu'une
    // photo de profil importée : lit comme un vrai personnage dessiné, cohérent avec le reste du
    // corps — l'identité du joueur reste visible via son pseudo au-dessus du terrain.
    function drawHead(side: Side, x: number, y: number) {
      if (!ctx) return;
      const style = avatarsRef.current[side];
      const colors = SIDE_COLORS[side];
      const r = PLAYER_RADIUS;

      ctx.save();

      // Peau.
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = style.skin;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();

      // Cheveux : calotte couvrant le haut du crâne + quelques mèches en pointes sur le devant.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = style.hair;
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.28, r * 1.05, r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const dx of [-0.42, -0.14, 0.14, 0.42]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * r * 2 - 5, y - r * 0.5);
        ctx.lineTo(x + dx * r * 2 + 5, y - r * 0.5);
        ctx.lineTo(x + dx * r * 2, y - r * 1.15);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // Contour du bord des cheveux (sur le pourtour visible de la tête uniquement).
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Bandeau couleur d'équipe sur le front — identifie le camp sans recourir à une photo.
      ctx.beginPath();
      ctx.arc(x, y - r * 0.04, r * 0.98, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = colors.jersey;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - r * 0.04, r * 0.98, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Sourcils (regard déterminé, légèrement froncé) + yeux + bouche.
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      const browY = y - r * 0.08;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.46, browY - 3);
      ctx.lineTo(x - r * 0.1, browY + 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + r * 0.1, browY + 4);
      ctx.lineTo(x + r * 0.46, browY - 3);
      ctx.stroke();

      ctx.fillStyle = "#1a1410";
      for (const dx of [-0.26, 0.26]) {
        ctx.beginPath();
        ctx.arc(x + dx * r, y + r * 0.14, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, y + r * 0.46);
      ctx.lineTo(x + r * 0.2, y + r * 0.46);
      ctx.stroke();

      ctx.restore();
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
            {/* Lettrage "bulle" doré à contour épais façon banderole d'arcade, plutôt qu'un badge
                plat — convention très générique du genre (texte de célébration bombé + contour
                foncé), pas une reprise d'un visuel précis. */}
            <span
              className="animate-bounce text-5xl font-black uppercase tracking-wide"
              style={{
                color: "#fff3c4",
                WebkitTextStroke: "3px #8a3b0a",
                textShadow: "0 5px 0 #c9780f, 0 8px 14px rgba(0,0,0,0.4)",
              }}
            >
              But !
            </span>
          </div>
        )}
      </div>

      {/* Deux zones de contrôle (gauche/droite), chacune triangle gauche/droite + saut —
          select-none/touch-none pour éviter la sélection de texte ou le défilement de la page
          pendant qu'on joue au doigt. Bande indigo tuilée + boutons dorés biseautés : l'écran de
          jeu a son identité propre, comme le tableau de score sur le canvas. */}
      <div className="grid grid-cols-2 gap-3 select-none rounded-2xl p-3" style={controlBarStyle}>
        <div className="flex items-center justify-center gap-2">
          <TriangleButton dir="left" handlers={holdButton("left", "left")} />
          <button {...holdButton("left", "jumpPressed")} style={gameButtonStyle} className={gameButtonClass}>
            ▲
          </button>
          <TriangleButton dir="right" handlers={holdButton("left", "right")} />
        </div>
        {mode === "local2p" ? (
          <div className="flex items-center justify-center gap-2">
            <TriangleButton dir="left" handlers={holdButton("right", "left")} />
            <button {...holdButton("right", "jumpPressed")} style={gameButtonStyle} className={gameButtonClass}>
              ▲
            </button>
            <TriangleButton dir="right" handlers={holdButton("right", "right")} />
          </div>
        ) : (
          <div className="flex items-center justify-center text-sm text-white/70">L&apos;IA se débrouille seule 🤖</div>
        )}
      </div>

      <button type="button" onClick={backToMenu} className={`${buttonSecondary} text-sm`}>
        Abandonner
      </button>
    </div>
  );
}
