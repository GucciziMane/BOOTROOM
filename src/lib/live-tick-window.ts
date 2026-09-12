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

// Incident du 12/09/2026 : wakeLiveTickIfNeeded (sync-fixtures) réveillait live-tick à CHAQUE
// passage (toutes les 30 min) dès qu'un match était dans la fenêtre, sans vérifier si une chaîne
// d'auto-réveil tournait déjà — sur une soirée à plusieurs matchs simultanés, ça a fini par
// empiler jusqu'à 6 chaînes indépendantes en parallèle (confirmé via les logs QStash), chacune
// insérant les mêmes buts et envoyant les mêmes notifications de fin de match. live-tick pose
// maintenant un "battement" (app_settings.live_tick_last_heartbeat) à chaque tick ; sync-fixtures
// ne réveille que si ce battement est absent ou plus vieux que ce seuil — nettement au-dessus du
// délai de tick le plus long (WARMUP_TICK_DELAY_SECONDS = 60s) pour ne jamais réveiller une
// chaîne saine en plein battement, mais assez court pour repartir vite si la chaîne est vraiment
// morte (erreur, crash, quota QStash épuisé).
export const LIVE_TICK_HEARTBEAT_STALE_MS = 3 * 60 * 1000;
