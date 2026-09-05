// Enregistre (ou met à jour, si SCHEDULE_ID connu) les schedules QStash qui remplacent le
// workflow GitHub Actions "Refresh match scores" — celui-ci ne respecte pas son intervalle
// configuré (délai réel constaté : 3h35 en moyenne, jusqu'à 14h, sur planification à 30 min),
// ce qui rendait la synchro des scores/points incertaine sans intervention manuelle.
//
// QStash appelle directement les endpoints cron existants avec le même header
// Authorization: Bearer CRON_SECRET que GitHub Actions utilisait — aucun changement côté route.
//
// Usage : node scripts/setup-qstash-schedules.mjs
import { Client } from "@upstash/qstash";

const APP_URL = "https://bootroom.online";

const qstashToken = process.env.QSTASH_TOKEN;
const cronSecret = process.env.CRON_SECRET;
if (!qstashToken) throw new Error("QSTASH_TOKEN manquant (vercel env pull)");
if (!cronSecret) throw new Error("CRON_SECRET manquant (vercel env pull)");

const client = new Client({ token: qstashToken });

const headers = { Authorization: `Bearer ${cronSecret}` };

// process-scoring décalé de 5 min après sync-fixtures pour lui laisser le temps de finir
// (sync-fixtures peut prendre jusqu'à ~3-4 min, cf. EVENTS_SYNC_TIME_BUDGET_MS côté route).
const schedules = [
  {
    label: "sync-fixtures",
    destination: `${APP_URL}/api/cron/sync-fixtures`,
    cron: "0,30 * * * *",
    deduplicationId: "bootroom-sync-fixtures",
  },
  {
    label: "process-scoring",
    destination: `${APP_URL}/api/cron/process-scoring`,
    cron: "5,35 * * * *",
    deduplicationId: "bootroom-process-scoring",
  },
];

for (const s of schedules) {
  const result = await client.schedules.create({
    destination: s.destination,
    cron: s.cron,
    method: "GET",
    headers,
    retries: 2,
    label: s.label,
    deduplicationId: s.deduplicationId,
  });
  console.log(`${s.label}: scheduleId=${result.scheduleId} cron="${s.cron}" -> ${s.destination}`);
}
