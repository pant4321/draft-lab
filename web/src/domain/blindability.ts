import { PAIR_KINDS } from './types';
import type {
  Champion,
  Draft,
  PairTable,
  Profile,
  Profiles,
  Role,
} from './types';

type SpreadOptions = {
  floor?: number;
  minGames?: number;
  minCoverage?: number;
  priorGames?: number;
};
type ThreatOptions = { ownChampion?: number | null };
export type Blindability = Record<
  number,
  ReturnType<typeof estimateCounterSafety> & {
    score: number | null;
    comparedWith: number;
  }
>;
export type SpreadRow = NonNullable<
  ReturnType<typeof groupSpread>['rows']
>[number];
export type PoolThreat = NonNullable<
  ReturnType<typeof suggestedPoolBans>
>[number];
export type CounterThreat = NonNullable<
  ReturnType<typeof remainingCounters>
>[number];

import { ROLES, pairContribution } from './draft-math';

// Informational only. These helpers do not change draft rankings.
export function groupSpread(
  pairs: PairTable | undefined,
  weights: Record<number, number>,
  { minGames = 100, minCoverage = 0.8 }: SpreadOptions = {},
) {
  let availableWeight = 0,
    coveredWeight = 0;
  const rows = [];
  for (const [id, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    availableWeight += weight;
    const p = pairs?.[Number(id)];
    if (
      !p ||
      !Number.isFinite(p[0]) ||
      !Number.isInteger(p[1]) ||
      p[1] < minGames ||
      p[2] === undefined ||
      !Number.isFinite(p[2]) ||
      p[2] < 0 ||
      p[2] > 1
    )
      continue;
    coveredWeight += weight;
    rows.push({ id: Number(id), delta: p[0], n: p[1], p: p[2], weight });
  }
  const coverage = availableWeight > 0 ? coveredWeight / availableWeight : 0;
  if (rows.length < 5 || coverage < minCoverage)
    return { resolved: false, coverage, count: rows.length };
  const mean = rows.reduce(
    (sum, r) => sum + (r.weight / coveredWeight) * r.delta,
    0,
  );
  const observedVariance = rows.reduce(
    (sum, r) => sum + (r.weight / coveredWeight) * (r.delta - mean) ** 2,
    0,
  );
  const noiseVariance = rows.reduce((sum, r) => {
    const w = r.weight / coveredWeight;
    return sum + (w * (1 - w) * 10000 * r.p * (1 - r.p)) / (r.n - 1);
  }, 0);
  return {
    resolved: true,
    coverage,
    count: rows.length,
    mean,
    rows: rows.map((r) => ({ ...r, weight: r.weight / coveredWeight })),
    observedVariance,
    noiseVariance,
    trueVariance: observedVariance - noiseVariance,
  };
}
export function estimateBlindSpread(
  profile: Profile,
  champions: readonly Champion[],
  { floor = 0.5, minGames = 100, minCoverage = 0.8 }: SpreadOptions = {},
) {
  const groups = [];
  for (const kind of PAIR_KINDS)
    for (const role of ROLES) {
      if (kind === 'ally' && role === profile.role) continue;
      const weights: Record<number, number> = {};
      for (const c of champions) {
        if (c.id === profile.id) continue;
        const weight = c.roles[role]?.pickRate ?? 0;
        if (weight >= floor) weights[c.id] = weight;
      }
      groups.push({
        kind,
        role,
        ...groupSpread(profile[kind]?.[role], weights, {
          minGames,
          minCoverage,
        }),
      });
    }
  const ready = groups.every((g) => g.resolved);
  const variance = ready
    ? groups.reduce((sum, g) => sum + (g.trueVariance ?? 0), 0) / groups.length
    : null;
  return {
    id: profile.id,
    groups,
    resolved: variance != null && variance > 0,
    spread: variance != null && variance > 0 ? Math.sqrt(variance) : null,
    reason: !ready
      ? 'Not enough common matchup data across all roles.'
      : variance != null && variance <= 0
        ? 'Sampling noise is too large to resolve consistency.'
        : null,
  };
}
export function counterpickRisk(
  pairs: PairTable | undefined,
  weights: Record<number, number>,
  { minGames = 100, minCoverage = 0.8, priorGames = 1000 }: SpreadOptions = {},
) {
  if (!Number.isFinite(priorGames) || priorGames < 0)
    throw Error('Invalid sample adjustment.');
  let availableWeight = 0,
    coveredWeight = 0;
  const rows = [];
  for (const [id, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    availableWeight += weight;
    const pair = pairContribution(pairs?.[Number(id)], priorGames);
    if (!pair || pair.games < minGames) continue;
    coveredWeight += weight;
    rows.push({ id: Number(id), weight, ...pair });
  }
  const coverage = availableWeight > 0 ? coveredWeight / availableWeight : 0;
  if (rows.length < 5 || coverage < minCoverage)
    return {
      resolved: false,
      loss: null,
      coverage,
      count: rows.length,
      rows: [],
    };
  const normalized = rows.map((r) => ({
    ...r,
    weight: r.weight / coveredWeight,
  }));
  const loss = normalized.reduce(
    (sum, r) => sum + r.weight * Math.max(0, -r.adjusted),
    0,
  );
  return {
    resolved: true,
    loss,
    coverage,
    count: rows.length,
    rows: normalized,
  };
}

function takenChampions(draft: Draft, ownChampion: number | null) {
  return new Set([
    ownChampion,
    ...Object.values(draft.allies),
    ...Object.values(draft.enemies),
    ...(draft.bans ?? []),
  ]);
}

function counterDownside(adjusted: number) {
  const downside = Math.max(0, -adjusted);
  return downside * Math.exp(0.4 * Math.min(downside, 4));
}

function rankCounterThreats(
  profiles: Profile[],
  champions: readonly Champion[],
  draft: Draft,
  taken: ReadonlySet<number | null>,
  limit: number,
) {
  const openRoles = ROLES.filter((role) => draft.enemies[role] == null);
  if (!openRoles.length) return null;
  if (!profiles.length) return [];
  const threats = new Map<
    number,
    {
      id: number;
      role: Role;
      pickShare: number;
      risk: number;
      pairs: NonNullable<ReturnType<typeof pairContribution>>[];
    }
  >();
  for (const champion of champions) {
    if (taken.has(champion.id)) continue;
    for (const role of openRoles) {
      const pickShare = champion.roles[role]?.pickRate;
      if (
        pickShare === undefined ||
        !Number.isFinite(pickShare) ||
        pickShare < 0.5
      )
        continue;
      const pairs = profiles
        .map((profile) =>
          pairContribution(profile.enemy?.[role]?.[champion.id]),
        )
        .filter((pair) => pair !== null)
        .filter((pair) => pair.games >= 5000);
      if (pairs.length !== profiles.length) continue;
      const totalDownside = pairs.reduce(
        (sum, pair) => sum + counterDownside(pair.adjusted),
        0,
      );
      const risk = ((pickShare / 100) * totalDownside) / pairs.length;
      if (risk > (threats.get(champion.id)?.risk ?? 0)) {
        threats.set(champion.id, {
          id: champion.id,
          role,
          pickShare,
          risk,
          pairs,
        });
      }
    }
  }
  return [...threats.values()]
    .sort((a, b) => b.risk - a.risk || a.id - b.id)
    .slice(0, limit);
}

export function remainingCounters(
  profile: Profile,
  champions: readonly Champion[],
  draft: Draft,
  { ownChampion = null }: ThreatOptions = {},
) {
  const taken = takenChampions(draft, ownChampion);
  taken.add(profile.id);
  const threats = rankCounterThreats([profile], champions, draft, taken, 3);
  return (
    threats?.map(({ pairs, ...threat }) => ({ ...threat, ...pairs[0] })) ?? null
  );
}

export function suggestedPoolBans(
  roleProfiles: Profiles,
  pool: readonly number[],
  champions: readonly Champion[],
  draft: Draft,
  { ownChampion = null }: ThreatOptions = {},
) {
  const taken = takenChampions(draft, ownChampion);
  const available = pool
    .filter((id) => !taken.has(id) && roleProfiles[id])
    .map((id) => roleProfiles[id]);
  for (const id of pool) taken.add(id);
  const threats = rankCounterThreats(available, champions, draft, taken, 5);
  return (
    threats?.map(({ pairs, ...threat }) => {
      let affected = 0,
        worstIndex = 0;
      for (const [index, pair] of pairs.entries()) {
        if (pair.adjusted < 0) affected++;
        if (pair.adjusted < pairs[worstIndex].adjusted) worstIndex = index;
      }
      const worst = { id: available[worstIndex].id, ...pairs[worstIndex] };
      const poolShare = threat.pickShare / 100 / pairs.length;
      const contributions = pairs.map(({ adjusted, games }, index) => ({
        id: available[index].id,
        adjusted,
        games,
        priority: poolShare * counterDownside(adjusted),
      }));
      return {
        ...threat,
        affected,
        poolSize: pairs.length,
        worst,
        contributions,
      };
    }) ?? null
  );
}

export function estimateCounterSafety(
  profile: Profile,
  champions: readonly Champion[],
  options: SpreadOptions = {},
) {
  const { floor = 0 } = options;
  // The graphs retain their common-champion filter. Safety includes rare recorded roles too.
  const visual = estimateBlindSpread(profile, champions, {
    ...options,
    floor: 0.5,
  });
  const counterGroups = ROLES.map((role) => {
    const weights: Record<number, number> = {};
    for (const c of champions) {
      const weight = c.roles[role]?.pickRate ?? 0;
      if (c.id !== profile.id && weight > 0 && weight >= floor)
        weights[c.id] = weight;
    }
    return {
      role,
      ...counterpickRisk(profile.enemy?.[role], weights, options),
    };
  });
  const resolved = counterGroups.every((g) => g.resolved);
  const counterLoss = resolved
    ? counterGroups.reduce((sum, g) => sum + (g.loss ?? 0), 0)
    : null;
  return {
    ...visual,
    resolved,
    wr: profile.wr,
    counterGroups,
    counterLoss,
    reason: !resolved
      ? 'Not enough enemy matchup data across all five roles.'
      : null,
  };
}

export function roleBlindability(
  profiles: Profiles,
  champions: readonly Champion[],
  options: SpreadOptions = {},
): Blindability {
  const values = Object.values(profiles).map((p) =>
    estimateCounterSafety(p, champions, options),
  );
  const resolved = values.filter((v) => v.resolved);
  return Object.fromEntries(
    values.map((v) => {
      let score = null;
      if (v.resolved && resolved.length >= 2) {
        let worse = 0,
          ties = 0;
        for (const other of resolved) {
          if (other.id === v.id) continue;
          const difference = (other.counterLoss ?? 0) - (v.counterLoss ?? 0);
          if (difference > 1e-9) worse++;
          else if (Math.abs(difference) <= 1e-9) ties++;
        }
        score = Math.round(
          (100 * (worse + 0.5 * ties)) / (resolved.length - 1),
        );
      }
      return [v.id, { ...v, score, comparedWith: resolved.length }];
    }),
  );
}
