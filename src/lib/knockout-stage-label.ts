/** Libellé FR d'un tour à élimination directe (Ligue des Champions), affiché à la place d'un
 * numéro de "journée" une fois la phase de ligue terminée — voir matches.stage et le calcul de
 * journée synthétique dans /api/cron/sync-fixtures. */
export const KNOCKOUT_STAGE_LABEL: Record<string, string> = {
  PLAYOFFS: "Barrages",
  LAST_16: "8es de finale",
  QUARTER_FINALS: "1/4 de finale",
  SEMI_FINALS: "1/2 finale",
  FINAL: "Finale",
};
