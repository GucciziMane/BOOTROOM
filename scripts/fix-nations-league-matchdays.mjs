// Corrige la numérotation des journées de la Ligue des Nations (actuellement Ligue A seule, voir
// scripts/prune-nations-league-to-league-a.mjs) : sync-nations-league.mjs dérivait la journée
// d'un simple écart de dates (> 2 jours = nouvelle journée), ce qui fusionnait à tort les
// trêves de septembre et octobre en une seule "J1" (l'écart entre les deux n'étant que de 2 jours)
// et écrasait la distinction J1/J2 à l'intérieur de chaque trêve (divisions qui jouent des jours
// différents, écart d'1 jour entre elles).
//
// Reconstruction fiable (jamais un numéro officiel supposé, dérivée des vrais matchs en base) :
// les matchs sont traités par ordre chronologique et chaque match est assigné à la plus petite
// journée où ni l'équipe à domicile ni l'équipe à l'extérieur n'a déjà joué — même principe qu'un
// calendrier round-robin réel, où chaque équipe joue exactement une fois par journée. Revérifié
// avant écriture : 6 journées de 8 matchs, aucune équipe deux fois dans la même journée, dates
// groupées par paquets de 3 jours cohérents avec les 3 vraies trêves internationales (sept/oct/nov).
//
// Idempotent : recalcule entièrement depuis les matchs actuels à chaque exécution.
//
// Usage : set -a; source .env.local; set +a; npx tsx scripts/fix-nations-league-matchdays.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: league } = await supabase.from("leagues").select("id").eq("football_data_code", "NL").maybeSingle();
  if (!league) throw new Error('Ligue "NL" introuvable.');

  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, kickoff_at, matchday")
    .eq("league_id", league.id)
    .order("kickoff_at", { ascending: true });
  if (!matches || matches.length === 0) throw new Error("Aucun match trouvé.");

  const lastMatchdayByTeam = new Map();
  const updates = [];
  for (const m of matches) {
    let matchday = 1;
    while ((lastMatchdayByTeam.get(m.home_team_id) ?? 0) >= matchday || (lastMatchdayByTeam.get(m.away_team_id) ?? 0) >= matchday) {
      matchday++;
    }
    lastMatchdayByTeam.set(m.home_team_id, matchday);
    lastMatchdayByTeam.set(m.away_team_id, matchday);
    if (m.matchday !== matchday) updates.push({ id: m.id, matchday });
  }

  // Garde-fou avant d'écrire quoi que ce soit : une équipe ne doit jamais apparaître deux fois
  // dans la journée qu'on s'apprête à lui assigner (round-robin réel, jamais deux matchs le même
  // jour de championnat pour une même équipe).
  const teamsByMatchday = new Map();
  for (const m of matches) {
    const matchday = updates.find((u) => u.id === m.id)?.matchday ?? m.matchday;
    const set = teamsByMatchday.get(matchday) ?? new Set();
    for (const teamId of [m.home_team_id, m.away_team_id]) {
      if (set.has(teamId)) throw new Error(`Équipe ${teamId} deux fois en journée ${matchday} — abandon par sécurité.`);
      set.add(teamId);
    }
    teamsByMatchday.set(matchday, set);
  }

  console.log(`${matches.length} matchs, ${updates.length} à corriger, ${teamsByMatchday.size} journées reconstruites.`);
  for (const [matchday, teams] of [...teamsByMatchday.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  J${matchday}: ${teams.size / 2} matchs`);
  }

  for (const u of updates) {
    const { error } = await supabase.from("matches").update({ matchday: u.matchday }).eq("id", u.id);
    if (error) throw new Error(`Mise à jour match ${u.id}: ${error.message}`);
  }

  console.log(`Terminé : ${updates.length} matchs corrigés.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
