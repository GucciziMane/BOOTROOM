// Moteur physique minimal pour "Têtes & Ballon" (voir SoccerHeadsGame.tsx) — mécanique propre,
// jamais copiée d'un jeu existant (voir l'échange avec l'utilisateur : aucun des dépôts "head
// soccer" trouvés n'avait de licence utilisable, donc tout ici est écrit à partir de zéro). Unités
// logiques (pas des pixels CSS) : le composant qui dessine applique son propre facteur d'échelle
// selon la taille réelle du canvas.

export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 420;
export const GROUND_Y = 370; // ligne de pelouse : les têtes/le ballon reposent dessus
export const GOAL_HEIGHT = 90;
export const GOAL_DEPTH = 14; // épaisseur du poteau, pour distinguer "dans le but" de "sur le poteau"

export const PLAYER_RADIUS = 30;
export const BALL_RADIUS = 13;

const GRAVITY = 1700; // unités/s²
const MOVE_ACCEL = 2600;
const MOVE_MAX_SPEED = 300;
const MOVE_DAMPING = 10; // décélération quand aucune touche n'est pressée
const JUMP_VELOCITY = -640;
const BALL_GRAVITY = 1100;
const BALL_GROUND_BOUNCE = 0.72;
const BALL_WALL_BOUNCE = 0.65;
const BALL_AIR_DRAG = 0.999; // frottement de l'air, par frame à 60fps (appliqué au prorata du pas de temps)
const BALL_GROUND_FRICTION = 0.985;
const KICK_BASE_IMPULSE = 520;
const KICK_VELOCITY_TRANSFER = 0.55; // part de la vitesse du joueur transmise au ballon à l'impact

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  pos: Vec2;
  vel: Vec2;
  grounded: boolean;
  facing: 1 | -1;
  // Entrées lues à chaque frame (pas un évènement ponctuel) : un bouton maintenu doit continuer à
  // agir tant qu'il est pressé, exactement comme un vrai pad.
  input: { left: boolean; right: boolean; jumpPressed: boolean };
}

export interface BallState {
  pos: Vec2;
  vel: Vec2;
}

export type Side = "left" | "right";

export interface MatchState {
  players: Record<Side, PlayerState>;
  ball: BallState;
  score: Record<Side, number>;
  // Les deux équipes défendent respectivement le but gauche/droit — fixe pour tout le match, pas
  // de changement de camp à la mi-temps (pas de notion de mi-temps ici, matchs courts).
  goalScoredSide: Side | null; // non-null un court instant après un but, pour l'animation/la pause
}

function createPlayer(pos: Vec2, facing: 1 | -1): PlayerState {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, grounded: true, facing, input: { left: false, right: false, jumpPressed: false } };
}

export function createMatchState(): MatchState {
  return {
    players: {
      left: createPlayer({ x: WORLD_WIDTH * 0.25, y: GROUND_Y }, 1),
      right: createPlayer({ x: WORLD_WIDTH * 0.75, y: GROUND_Y }, -1),
    },
    ball: { pos: { x: WORLD_WIDTH / 2, y: GROUND_Y - 120 }, vel: { x: 0, y: 0 } },
    score: { left: 0, right: 0 },
    goalScoredSide: null,
  };
}

/** Repositionne joueurs/ballon après un but, sans toucher au score (déjà incrémenté par l'appelant). */
export function resetPositions(state: MatchState): void {
  state.players.left.pos = { x: WORLD_WIDTH * 0.25, y: GROUND_Y };
  state.players.left.vel = { x: 0, y: 0 };
  state.players.right.pos = { x: WORLD_WIDTH * 0.75, y: GROUND_Y };
  state.players.right.vel = { x: 0, y: 0 };
  state.ball.pos = { x: WORLD_WIDTH / 2, y: GROUND_Y - 120 };
  state.ball.vel = { x: 0, y: 0 };
  state.goalScoredSide = null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stepPlayer(player: PlayerState, dt: number): void {
  const { input } = player;
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (direction !== 0) {
    player.vel.x += direction * MOVE_ACCEL * dt;
    player.vel.x = clamp(player.vel.x, -MOVE_MAX_SPEED, MOVE_MAX_SPEED);
    player.facing = direction > 0 ? 1 : -1;
  } else {
    // Amortissement exponentiel plutôt que linéaire : s'arrête net à basse vitesse au lieu de
    // glisser indéfiniment à une fraction de plus en plus petite.
    player.vel.x *= Math.max(0, 1 - MOVE_DAMPING * dt);
    if (Math.abs(player.vel.x) < 2) player.vel.x = 0;
  }

  if (input.jumpPressed && player.grounded) {
    player.vel.y = JUMP_VELOCITY;
    player.grounded = false;
  }

  player.vel.y += GRAVITY * dt;
  player.pos.x += player.vel.x * dt;
  player.pos.y += player.vel.y * dt;

  if (player.pos.y >= GROUND_Y) {
    player.pos.y = GROUND_Y;
    player.vel.y = 0;
    player.grounded = true;
  }
  player.pos.x = clamp(player.pos.x, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);
}

function stepBall(ball: BallState, dt: number): void {
  ball.vel.y += BALL_GRAVITY * dt;
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;

  // Le "sol" du ballon est le même niveau que les pieds des joueurs (GROUND_Y) : les deux
  // utilisent la même ligne de pelouse, le ballon rebondit juste depuis le bord de son propre
  // cercle plutôt que depuis son centre, d'où l'ajustement par BALL_RADIUS.
  const ballGroundY = GROUND_Y - BALL_RADIUS;
  if (ball.pos.y >= ballGroundY) {
    ball.pos.y = ballGroundY;
    ball.vel.y = -ball.vel.y * BALL_GROUND_BOUNCE;
    ball.vel.x *= BALL_GROUND_FRICTION;
    if (Math.abs(ball.vel.y) < 30) ball.vel.y = 0;
  }
  if (ball.pos.y - BALL_RADIUS < 0) {
    ball.pos.y = BALL_RADIUS;
    ball.vel.y = -ball.vel.y * BALL_GROUND_BOUNCE;
  }

  // Murs latéraux : seulement hors de la hauteur du but (sinon le ballon rebondirait sur une cage
  // ouverte) — dans la zone de but, c'est resolveGoal (appelé par l'appelant) qui décide.
  if (ball.pos.y < GROUND_Y - GOAL_HEIGHT) {
    if (ball.pos.x - BALL_RADIUS < 0) {
      ball.pos.x = BALL_RADIUS;
      ball.vel.x = -ball.vel.x * BALL_WALL_BOUNCE;
    } else if (ball.pos.x + BALL_RADIUS > WORLD_WIDTH) {
      ball.pos.x = WORLD_WIDTH - BALL_RADIUS;
      ball.vel.x = -ball.vel.x * BALL_WALL_BOUNCE;
    }
  }

  ball.vel.x *= BALL_AIR_DRAG;
}

// Sens d'attaque de chaque côté (vers quel but il essaie de marquer) — sert à biaiser les
// contacts tête/ballon vers l'avant plutôt que de suivre aveuglément la géométrie pure du contact
// (voir resolvePlayerBallCollision ci-dessous pour le pourquoi).
const ATTACK_DIRECTION: Record<Side, 1 | -1> = { left: 1, right: -1 };
// Part de l'impulsion toujours dirigée vers le but adverse, le reste suivant la géométrie réelle
// du contact (position relative tête/ballon) — sans ce biais, un joueur mal placé entre le ballon
// et SON PROPRE but (fréquent pour une IA simple qui fonce droit sur le ballon) le renvoie tout
// droit contre son camp à la moindre tête, un contact ballon/tête n'ayant alors plus rien d'une
// "frappe" volontaire. 0.5 garde quand même une vraie variation selon l'angle du contact — pas un
// aimant qui ramènerait toujours le ballon pile vers le but, juste une tendance.
const COLLISION_ATTACK_BIAS = 0.85;

function resolvePlayerBallCollision(player: PlayerState, ball: BallState, side: Side): void {
  const dx = ball.pos.x - player.pos.x;
  const dy = ball.pos.y - player.pos.y;
  const dist = Math.hypot(dx, dy);
  const minDist = PLAYER_RADIUS + BALL_RADIUS;
  if (dist >= minDist || dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  // Repousse le ballon hors de la tête (pas le joueur : le ballon est bien plus léger) pour éviter
  // qu'il ne reste "collé" plusieurs frames d'affilée à grande vitesse.
  ball.pos.x += nx * overlap;
  ball.pos.y += ny * overlap;

  const impactSpeed = Math.hypot(player.vel.x, player.vel.y);
  const impulse = KICK_BASE_IMPULSE + impactSpeed * KICK_VELOCITY_TRANSFER;
  const biasedNx = nx * (1 - COLLISION_ATTACK_BIAS) + ATTACK_DIRECTION[side] * COLLISION_ATTACK_BIAS;
  ball.vel.x = biasedNx * impulse + player.vel.x * 0.3;
  ball.vel.y = ny * impulse + player.vel.y * 0.3;
}

/** But marqué CE pas de temps (le ballon vient de franchir une ligne de but), sinon null. Le côté
 * renvoyé est celui qui ENCAISSE (son but a été franchi), pas celui qui marque. */
function detectGoal(ball: BallState): Side | null {
  const inGoalHeight = ball.pos.y > GROUND_Y - GOAL_HEIGHT;
  if (!inGoalHeight) return null;
  if (ball.pos.x - BALL_RADIUS < -GOAL_DEPTH) return "left";
  if (ball.pos.x + BALL_RADIUS > WORLD_WIDTH + GOAL_DEPTH) return "right";
  return null;
}

/** Fait avancer la simulation d'un pas `dt` (secondes). Renvoie le côté qui vient d'encaisser un
 * but ce pas-ci, ou null — l'appelant incrémente le score et déclenche la pause/l'animation, cette
 * fonction ne fait que la physique pure. */
export function stepMatch(state: MatchState, dt: number): Side | null {
  if (state.goalScoredSide) return null; // pause après un but, voir l'appelant pour la reprise

  stepPlayer(state.players.left, dt);
  stepPlayer(state.players.right, dt);
  stepBall(state.ball, dt);
  resolvePlayerBallCollision(state.players.left, state.ball, "left");
  resolvePlayerBallCollision(state.players.right, state.ball, "right");

  const conceding = detectGoal(state.ball);
  if (conceding) {
    const scoringSide: Side = conceding === "left" ? "right" : "left";
    state.score[scoringSide]++;
    state.goalScoredSide = conceding;
  }
  return conceding;
}
