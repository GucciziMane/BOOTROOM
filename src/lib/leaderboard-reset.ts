// Remise à zéro des classements généraux (pronostics + quiz) pour l'arrivée de nouveaux joueurs :
// seuls les points/scores postérieurs à cette date comptent pour tout le monde — voir
// app_settings, clé LEADERBOARD_RESET_KEY. Rien n'est supprimé en base, seul ce qui est
// affiché/sommé change. Les deux comptes de PRIVATE_RANKING_USERNAMES gardent en plus un
// classement privé (non affiché aux autres) avec leurs totaux complets, avant et après.
// Partagé entre src/app/leaderboard/page.tsx et src/app/quiz/actions.ts pour que les deux
// classements utilisent exactement la même date de coupure et la même liste de comptes.
export const LEADERBOARD_RESET_KEY = "leaderboard_reset_at";
export const PRIVATE_RANKING_USERNAMES = ["GucciziMane", "kaism10"];
