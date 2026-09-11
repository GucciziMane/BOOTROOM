// Remise à zéro du classement général des pronos pour l'arrivée de nouveaux joueurs : seuls les
// points postérieurs à cette date comptent pour tout le monde — voir app_settings, clé
// LEADERBOARD_RESET_KEY. Rien n'est supprimé en base, seul ce qui est affiché/sommé change. Les
// deux comptes de PRIVATE_RANKING_USERNAMES gardent en plus un classement privé (non affiché aux
// autres) avec leurs totaux complets, avant et après. Partagé entre src/app/leaderboard/page.tsx
// et le cron du bonus mi-saison pour que les deux utilisent exactement la même date de coupure.
export const LEADERBOARD_RESET_KEY = "leaderboard_reset_at";
export const PRIVATE_RANKING_USERNAMES = ["GucciziMane", "kaism10"];

// Saison du quiz : clé SÉPARÉE de LEADERBOARD_RESET_KEY (jusqu'à la migration 0050, les deux
// classements — pronos et quiz — partageaient la même coupure). Le quiz repart sur une saison
// vierge chaque 1er janvier (voir src/app/api/cron/quiz-season-bonus/route.ts) sans jamais
// affecter le classement des pronos, qui continue d'accumuler indépendamment.
export const QUIZ_SEASON_RESET_KEY = "quiz_season_reset_at";
