// Ballon d'Or 2026 (cérémonie du 26/10/2026, Londres) : saisit le top 10 officiel, paie les points
// exactement comme processBallonDor (src/app/api/cron/process-scoring/route.ts) sans attendre le
// prochain passage du cron, puis poste le récap dans le chat (message système + push).
//
// Top 10 officiel recoupé (Yahoo Sports, CBS Sports, Foot01, Footmercato — jamais inventé) :
// 1 Kane, 2 Mbappé, 3 Yamal, 4 Rodri, 5 Messi, 6 Kvaratskhelia, 7 Dembélé, 8 Haaland, 9 Olise,
// 10 Fabián Ruiz.
//
// Usage : set -a; source .env.local; set +a; node scripts/apply-ballon-dor-2026.mjs
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SYSTEM_SENDER_NAME = "Gianni Infantino";
const YEAR = 2026;
// rang -> ballon_dor_nominees.id (voir migration 0060)
const ACTUAL = { 1: 10, 2: 16, 3: 12, 4: 24, 5: 18, 6: 11, 7: 4, 8: 8, 9: 20, 10: 25 };
// Copie de BALLON_DOR_RANK_POINTS (src/lib/scoring/ballon-dor.ts).
const RANK_POINTS = { 1: 50, 2: 30, 3: 20, 4: 15, 5: 15, 6: 10, 7: 10, 8: 10, 9: 10, 10: 10 };

async function main() {
  const { data: edition, error: edErr } = await supabase
    .from("ballon_dor_editions")
    .select("id, points_processed_at")
    .eq("year", YEAR)
    .single();
  if (edErr) throw edErr;
  if (edition.points_processed_at) throw new Error("Édition déjà traitée, rien à faire.");

  const rankUpdate = Object.fromEntries(Object.entries(ACTUAL).map(([rank, id]) => [`rank_${rank}_nominee_id`, id]));
  const { error: rankErr } = await supabase.from("ballon_dor_editions").update(rankUpdate).eq("id", edition.id);
  if (rankErr) throw rankErr;

  const { data: predictions, error: predErr } = await supabase
    .from("ballon_dor_predictions")
    .select("user_id, picks")
    .eq("edition_year", YEAR);
  if (predErr) throw predErr;

  const scored = predictions.map((p) => {
    let points = 0;
    for (let rank = 1; rank <= 10; rank++) {
      if (p.picks[String(rank)] === ACTUAL[rank]) points += RANK_POINTS[rank];
    }
    return { user_id: p.user_id, points };
  });

  const ledgerInserts = scored
    .filter((s) => s.points > 0)
    .map((s) => ({ user_id: s.user_id, league_id: null, source_type: "ballon_dor", source_id: edition.id, points: s.points }));
  if (ledgerInserts.length > 0) {
    const { error } = await supabase
      .from("points_ledger")
      .upsert(ledgerInserts, { onConflict: "user_id,source_type,source_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  const { error: procErr } = await supabase
    .from("ballon_dor_editions")
    .update({ points_processed_at: new Date().toISOString() })
    .eq("id", edition.id);
  if (procErr) throw procErr;
  console.log(`Points payés : ${ledgerInserts.length} ligne(s) points_ledger.`);

  const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", scored.map((s) => s.user_id));
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const ranking = scored
    .map((s) => ({ username: nameById.get(s.user_id) ?? "?", points: s.points }))
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));

  const medals = ["🥇", "🥈", "🥉"];
  const content = [
    "🏆 Ballon d'Or 2026 : les points sont tombés !",
    "",
    "Le podium officiel : 1. Harry Kane · 2. Kylian Mbappé · 3. Lamine Yamal",
    "",
    "Récap des points gagnés :",
    ...ranking.map((r, i) => `${medals[i] ?? `${i + 1}.`} @${r.username} — ${r.points} pts`),
    "",
    "Le détail place par place est sur la page Ballon d'Or 👀",
  ].join("\n");

  const { error: chatErr } = await supabase.from("chat_messages").insert({ user_id: null, content, is_system: true });
  if (chatErr) throw new Error(`Insertion message: ${chatErr.message}`);
  console.log("Message posté dans le chat :\n" + content);

  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (!subscriptions || subscriptions.length === 0) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: SYSTEM_SENDER_NAME,
    body: `🏆 Points du Ballon d'Or distribués — @${ranking[0].username} en tête avec ${ranking[0].points} pts`,
    url: "/chat",
  });
  const staleIds = [];
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
      }
    })
  );
  if (staleIds.length > 0) await supabase.from("push_subscriptions").delete().in("id", staleIds);
  console.log(`Push envoyé à ${subscriptions.length - staleIds.length} abonné(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
