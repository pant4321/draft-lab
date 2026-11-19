import { PAIR_KINDS, byRole, isRole } from './types';
import type {
  Champion,
  PairTable,
  Profile,
  Profiles,
  Role,
  RoleMap,
  Roster,
} from './types';
import { ROLES } from './draft-math';

// Match the offline aggregation in scripts/patch_data.py. The inputs are
// ordered, distinct patches with effects already normalized within each patch.
export function combinePatchCatalogs(
  catalogs: readonly { champions: Champion[] }[],
) {
  const champions = new Map<number, Champion>(),
    totals = byRole(() => 0);
  for (const catalog of catalogs) {
    for (const { roles, ...champion } of catalog.champions) {
      const combined = champions.get(champion.id)?.roles ?? {};
      champions.set(champion.id, { ...champion, roles: combined });
      for (const [role, value] of Object.entries(roles)) {
        if (!isRole(role) || value.games <= 0) continue;
        const entry = (combined[role] ??= { games: 0, wr: 0 });
        entry.games += value.games;
        entry.wr += value.games * value.wr;
        totals[role] += value.games;
      }
    }
  }
  for (const { roles } of champions.values()) {
    for (const role of ROLES) {
      const value = roles[role];
      if (!value) continue;
      value.wr /= value.games;
      value.pickRate = (100 * value.games) / totals[role];
    }
  }
  return champions;
}

export function combinePatchRole(
  parts: Profiles[],
  champions: Roster,
  role: Role,
  candidateFloor: number,
): Profiles {
  const byChampion = new Map<string, Profile[]>(),
    result: Profiles = {};
  for (const profiles of parts) {
    for (const [id, profile] of Object.entries(profiles)) {
      if (!byChampion.has(id)) byChampion.set(id, []);
      byChampion.get(id)!.push(profile);
    }
  }
  for (const [id, profiles] of byChampion) {
    const roles = champions.get(Number(id))?.roles,
      meta = roles?.[role];
    const games = profiles.reduce((sum, profile) => sum + profile.games, 0);
    if (!roles || !meta || games < 1000) continue;
    if ((meta.pickRate ?? 0) < candidateFloor) {
      const primary = Object.keys(roles)
        .filter(isRole)
        .reduce((best, current) =>
          (roles[current]?.games ?? 0) > (roles[best]?.games ?? 0)
            ? current
            : best,
        );
      if (primary !== role) continue;
    }
    const value: Profile = {
      id: Number(id),
      role,
      games,
      wr:
        profiles.reduce((sum, profile) => sum + profile.games * profile.wr, 0) /
        games,
    };
    for (const kind of PAIR_KINDS) {
      const rolePairs: Partial<RoleMap<PairTable>> = {};
      value[kind] = rolePairs;
      for (const other of ROLES) {
        if (kind === 'ally' && other === role) continue;
        const pairs: Record<number, [number, number, number]> = {};
        rolePairs[other] = pairs;
        for (const profile of profiles) {
          for (const [opponent, [delta, n, wr]] of Object.entries(
            profile[kind]?.[other] ?? {},
          )) {
            const pair = (pairs[Number(opponent)] ??= [0, 0, 0]);
            pair[0] += delta * n;
            pair[1] += n;
            pair[2] += (wr ?? NaN) * n;
          }
        }
        for (const pair of Object.values(pairs)) {
          pair[0] /= pair[1];
          pair[2] /= pair[1];
        }
      }
    }
    result[Number(id)] = value;
  }
  return result;
}
