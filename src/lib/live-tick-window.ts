// Fenêtre d'anticipation partagée entre sync-fixtures (réveil de la chaîne live-tick) et live-tick
// lui-même (fenêtre de suivi minute par minute) — voir l'incident du 11/09/2026 : ces deux valeurs
// vivaient dans deux fichiers séparés et avaient dérivé l'une de l'autre (35 min côté réveil, 5 min
// côté traitement). Un match à plus de 5 min de son coup d'envoi se faisait bien réveiller par
// sync-fixtures, mais live-tick ne le trouvait pas encore dans SA propre fenêtre (trop courte) : le
// tick ne faisait rien, ne se re-planifiait pas, et la chaîne mourait aussitôt née — jusqu'au
// passage sync-fixtures suivant, 25-30 minutes plus tard. Score/temps de jeu figés tout ce temps,
// symptôme identique à l'incident précédent (quota QStash épuisé) mais cause totalement différente.
// Une seule constante, importée des deux côtés, rend cette dérive structurellement impossible.
export const LIVE_TICK_LOOKAHEAD_MS = 35 * 60 * 1000;
