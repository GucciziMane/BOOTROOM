import { GROUND_Y, type MatchState, type PlayerState, type Side } from "./engine";

/** IA volontairement simple (pas de recherche de trajectoire, pas d'anticipation de rebond) :
 * suit le ballon horizontalement, saute quand il est au-dessus d'elle et assez proche. Un seul
 * niveau de difficulté pour l'instant — largement suffisant pour un adversaire "pour s'entraîner",
 * pas pensé comme un défi compétitif. */
export function computeAiInput(aiSide: Side, state: MatchState): PlayerState["input"] {
  const player = state.players[aiSide];
  const { ball } = state;
  const dx = ball.pos.x - player.pos.x;
  const deadZone = 18; // évite un tremblement gauche/droite quand le ballon est quasi aligné

  const left = dx < -deadZone;
  const right = dx > deadZone;

  const closeHorizontally = Math.abs(dx) < 90;
  const ballAbove = ball.pos.y < player.pos.y - 20;
  const jumpPressed = player.grounded && closeHorizontally && ballAbove && ball.pos.y < GROUND_Y - 40;

  return { left, right, jumpPressed };
}
