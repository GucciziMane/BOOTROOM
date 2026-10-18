import type { createServiceRoleClient } from "@/lib/supabase/server";
import { getEspnRoster, getEspnTeams, type EspnTeam } from "@/lib/espn/client";
import { matchPlayerByName, normalizeName, teamNamesMatch } from "@/lib/sync/name-match";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const POSITION_MAP: Record<string, "Goalkeeper" | "Defender" | "Midfielder" | "Attacker"> = {
  Goalkeeper: "Goalkeeper",
  Defender: "Defender",
  Midfielder: "Midfielder",
  Forward: "Attacker",
};

/**
 * Associe chacun de nos clubs à son club ESPN : d'abord les noms identiques une fois normalisés,
 * puis un rapprochement teamNamesMatch UNIQUE parmi les clubs ESPN restants. Le rapprochement seul
 * ne suffit pas : "Paris FC" ⊂ "Paris Saint-Germain" et "Barcelona" ⊂ "RCD Espanyol de
 * Barcelona" — vu à l'audit du 18/10/2026, le PSG récupérait l'effectif du Paris FC.
 */
function mapTeams(ours: Array<{ id: number; name: string }>, espnTeams: EspnTeam[]): Map<number, EspnTeam> {
  const names = (e: EspnTeam) => [e.displayName, e.name, e.shortDisplayName].filter((n): n is string => !!n);
  const result = new Map<number, EspnTeam>();
  const taken = new Set<string>();
  for (const team of ours) {
    const exact = espnTeams.find((e) => names(e).some((n) => normalizeName(n) === normalizeName(team.name)));
    if (exact) {
      result.set(team.id, exact);
      taken.add(exact.id);
    }
  }
  for (const team of ours) {
    if (result.has(team.id)) continue;
    const candidates = espnTeams.filter((e) => !taken.has(e.id) && names(e).some((n) => teamNamesMatch(n, team.name)));
    if (candidates.length === 1) {
      result.set(team.id, candidates[0]);
      taken.add(candidates[0].id);
    }
  }
  return result;
}

/**
 * Vrai si un joueur ESPN ressemble à un joueur déjà actif sans que matchPlayerByName ose les
 * relier : surnom d'un seul mot contre nom complet ("Isaac"/"Isaac Romero", "Reinildo"/"Reinildo
 * Mandava"), noms inversés ou partiels ("Nianzou Kouassi"/"Tanguy Nianzou"), orthographe à une
 * lettre près ("Jauregi"/"Jauregui"). Dans le doute on n'ajoute rien : un doublon rendrait les buts
 * de ce joueur ambigus (jamais reliés, donc jamais payés), alors que le joueur est déjà
 * sélectionnable sous son autre nom. Un prénom seul en commun ("Jorge Castillo"/"Jorge Domínguez")
 * ne compte pas ; deux mots en commun, si ("Lee Han-beom"/"Han-bum Lee"). Translittérations
 * longues à deux lettres près ("Rakhmonaliev"/"Rahmonaliyev", doublon déjà fusionné le 17/10/2026
 * qu'une simple réactivation aurait recréé).
 */
function looksLikeExistingPlayer(name: string, active: Array<{ name: string }>): boolean {
  // Clé phonétique pour les translittérations de l'azéri (Sabah FK : "Xayal"/"Khayal",
  // "Cəfər Muxtarov"/"Jafar Mukhtarov"), appliquée des deux côtés.
  const tokensOf = (raw: string) =>
    normalizeName(raw)
      .split(" ")
      .filter(Boolean)
      .map((t) => t.replace(/x/g, "kh").replace(/c/g, "j"));
  const target = tokensOf(name);
  if (target.length === 0) return true;
  const close = (a: string, b: string) => {
    if (a === b) return true;
    const min = Math.min(a.length, b.length);
    if (min < 6) return false;
    return editDistance(a, b) <= (min >= 10 ? 2 : 1);
  };
  return active.some((p) => {
    const other = tokensOf(p.name);
    if (other.length === 0) return false;
    if (target.length === 1 || other.length === 1) {
      const single = target.length === 1 ? target[0] : other[0];
      const rest = target.length === 1 ? other : target;
      return rest.some((t) => close(t, single));
    }
    if (target.filter((t) => t.length >= 2 && other.includes(t)).length >= 2) return true;
    return target.some((t, i) => t.length >= 4 && other.some((o, j) => (i > 0 || j > 0) && close(t, o)));
  });
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export interface EspnSquadSupplementResult {
  added: string[];
  reactivated: string[];
  skippedLookalikes: string[];
  unmappedTeams: string[];
  errors: string[];
}

/**
 * Complète les effectifs d'une compétition avec ESPN : football-data.org oublie des joueurs bien
 * réels (audit du 18/10/2026 : Keito Nakamura à Lyon, Gavi au Barça, ~390 joueurs au total), qui ne
 * pouvaient alors être choisis ni comme buteur ni comme passeur. Tourne APRÈS la synchro
 * football-data (qui marque "parti" toute ligne absente de sa réponse, y compris celles ajoutées
 * ici) : un joueur toujours présent chez ESPN est donc réactivé à chaque passage, et un joueur
 * qui a vraiment quitté le club disparaît des deux sources et reste parti. Lignes sans
 * football_data_id : si football-data finit par lister le joueur, adoptNameOnlyDuplicates
 * (sync-teams-players) reprend cette même ligne au lieu d'en créer une seconde.
 */
export async function supplementSquadsFromEspn(
  supabase: ServiceClient,
  leagueId: number,
  espnSlug: string,
  options: { dryRun?: boolean } = {}
): Promise<EspnSquadSupplementResult> {
  const result: EspnSquadSupplementResult = { added: [], reactivated: [], skippedLookalikes: [], unmappedTeams: [], errors: [] };
  const { data: teams } = await supabase.from("teams").select("id, name").eq("league_id", leagueId);
  if (!teams || teams.length === 0) return result;

  const espnTeamByTeamId = mapTeams(teams, await getEspnTeams(espnSlug));

  for (const team of teams) {
    const espnTeam = espnTeamByTeamId.get(team.id);
    if (!espnTeam) {
      result.unmappedTeams.push(team.name);
      continue;
    }
    let roster;
    try {
      roster = await getEspnRoster(espnSlug, espnTeam.id);
    } catch {
      continue;
    }
    if (roster.length === 0) continue;

    const { data: players } = await supabase
      .from("players")
      .select("id, name, position, left_at")
      .eq("team_id", team.id);
    const active = (players ?? []).filter((p) => p.left_at == null);
    const inactive = (players ?? []).filter((p) => p.left_at != null);

    const toInsert: Array<{ team_id: number; name: string; position: string; football_data_id: null; left_at: null }> = [];
    for (const athlete of roster) {
      const names = [athlete.displayName, athlete.fullName].filter((n): n is string => !!n);
      if (names.some((n) => matchPlayerByName(n, active))) continue;
      if (names.some((n) => looksLikeExistingPlayer(n, active))) {
        result.skippedLookalikes.push(`${team.name}: ${athlete.displayName}`);
        continue;
      }
      const previous = inactive.find((p) => names.some((n) => normalizeName(n) === normalizeName(p.name)));
      if (previous) {
        if (!options.dryRun) await supabase.from("players").update({ left_at: null }).eq("id", previous.id);
        active.push({ ...previous, left_at: null });
        result.reactivated.push(`${team.name}: ${previous.name}`);
        continue;
      }
      const position = POSITION_MAP[athlete.position ?? ""];
      if (!position) continue;
      toInsert.push({ team_id: team.id, name: athlete.displayName, position, football_data_id: null, left_at: null });
      active.push({ id: -1, name: athlete.displayName, position, left_at: null });
    }

    if (toInsert.length > 0 && options.dryRun) {
      result.added.push(...toInsert.map((p) => `${team.name}: ${p.name}`));
    } else if (toInsert.length > 0) {
      // Simple insert, pas d'upsert : l'unicité (team_id, name) n'est qu'un index PARTIEL (football_data_id
      // null, migration 0055), qu'un ON CONFLICT via PostgREST ne sait pas cibler (erreur 42P10). Les
      // homonymes déjà en base, actifs ou partis, sont écartés ou réactivés plus haut.
      const { error } = await supabase.from("players").insert(toInsert);
      if (error) result.errors.push(`${team.name}: ${error.message}`);
      else result.added.push(...toInsert.map((p) => `${team.name}: ${p.name}`));
    }
  }
  return result;
}
