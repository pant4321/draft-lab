import { ROLES, SIDES, byRole, isChampionId, isRecord, isRole } from './types';
import type {
  Draft,
  Pair,
  Profile,
  Profiles,
  Role,
  ScoreOptions,
  ScoredPair,
  Side,
  Slots,
} from './types';

export type ScoredCandidate = ReturnType<typeof scoreCandidate>;
type DraftRanking = {
  ready: boolean;
  ranked: ScoredCandidate[];
  insufficient: ScoredCandidate[];
  shown: number;
  ignored: number;
};

export { ROLES } from './types';
export const ROLE_NAMES = {
  top: 'Top',
  jungle: 'Jungle',
  middle: 'Mid',
  bottom: 'Bot',
  support: 'Support',
};
export const MAX_ROLE_MULTIPLIER = 5;
export function emptyDraft(role: Role = 'jungle'): Draft {
  return {
    role,
    allies: byRole(() => null),
    enemies: byRole(() => null),
    bans: [],
  };
}
export function validateDraft(draft: unknown): Draft {
  if (!isRecord(draft) || !isRole(draft.role))
    throw Error('Choose a valid role.');
  const seen = new Set();
  for (const side of SIDES) {
    const slots = draft[side];
    if (!isRecord(slots)) throw Error('Missing draft slots.');
    for (const role of ROLES) {
      const id = slots[role];
      if (id == null) continue;
      if (!isChampionId(id)) throw Error('Invalid champion.');
      if (side === 'allies' && role === draft.role)
        throw Error('Your role must stay open for recommendations.');
      if (seen.has(id)) throw Error('A champion can appear only once.');
      seen.add(id);
    }
  }
  if (draft.bans != null && !Array.isArray(draft.bans))
    throw Error('Invalid bans.');
  for (const id of draft.bans ?? []) {
    if (!isChampionId(id) || seen.has(id))
      throw Error('A champion cannot be picked and banned, or banned twice.');
    seen.add(id);
  }
  return {
    role: draft.role,
    allies: byRole((role) => (draft.allies as Slots)[role] ?? null),
    enemies: byRole((role) => (draft.enemies as Slots)[role] ?? null),
    bans: draft.bans ?? [],
  };
}
export function pairContribution(pair: Pair | undefined, priorGames = 1000) {
  if (
    !pair ||
    pair.length < 2 ||
    !Number.isFinite(pair[0]) ||
    !Number.isInteger(pair[1]) ||
    pair[1] <= 0
  )
    return null;
  if (!Number.isFinite(priorGames) || priorGames < 0)
    throw Error('Invalid sample adjustment.');
  return {
    raw: pair[0],
    games: pair[1],
    adjusted: (pair[0] * pair[1]) / (pair[1] + priorGames),
  };
}
function roleMultiplier(
  multipliers: ScoreOptions['multipliers'],
  side: Side,
  role: Role,
) {
  const value = multipliers?.[side]?.[role] ?? 1;
  if (!Number.isFinite(value) || value < 0 || value > MAX_ROLE_MULTIPLIER)
    throw Error('Role multipliers must be between 0 and 5.');
  return value;
}
export function scoreCandidate(
  profile: Profile,
  draft: Draft,
  {
    priorGames = 1000,
    includeStrength = false,
    multipliers,
    ignoredPicks,
  }: ScoreOptions = {},
) {
  const pairs: ScoredPair[] = [];
  let counter = 0,
    synergy = 0,
    missing = 0;
  for (const [side, kind] of [
    ['enemies', 'enemy'],
    ['allies', 'ally'],
  ] as const) {
    for (const role of ROLES) {
      const id = draft[side][role];
      if (id == null) continue;
      const effect = pairContribution(profile[kind]?.[role]?.[id], priorGames);
      const ignoredPick = ignoredPicks?.has(id);
      const multiplier = ignoredPick
        ? 0
        : roleMultiplier(multipliers, side, role);
      const weighted =
        multiplier === 0 ? 0 : effect ? effect.adjusted * multiplier : null;
      if (weighted != null) {
        if (kind === 'enemy') counter += weighted;
        else synergy += weighted;
      } else missing++;
      pairs.push({
        side,
        kind,
        role,
        id,
        ...(effect ?? { raw: null, games: 0, adjusted: null }),
        multiplier,
        weighted,
        ...(ignoredPick ? { ignoredPick: true } : {}),
      });
    }
  }
  const base = 100 * (profile.wr - 0.5),
    fit = counter + synergy;
  return {
    id: profile.id,
    role: profile.role,
    wr: profile.wr,
    priorGames,
    base,
    counter,
    synergy,
    fit,
    score: fit + (includeStrength ? base : 0),
    pairs,
    missing,
    complete: missing === 0,
    known: pairs.filter((p) => p.adjusted != null).length,
    smallSample: pairs.some(
      (p) => p.multiplier > 0 && p.games > 0 && p.games < 500,
    ),
  };
}
export function rankDraft(
  draft: Draft,
  profiles: Profiles,
  options: ScoreOptions = {},
): DraftRanking {
  validateDraft(draft);
  const picks = [
    ...Object.values(draft.allies),
    ...Object.values(draft.enemies),
  ].filter((id) => id != null);
  const blocked = new Set([...picks, ...(draft.bans ?? [])]);
  const shown = picks.length;
  const ignored = SIDES.reduce(
    (count, side) =>
      count +
      ROLES.filter((role) => {
        const id = draft[side][role];
        return (
          id != null &&
          (options.ignoredPicks?.has(id) ||
            roleMultiplier(options.multipliers, side, role) === 0)
        );
      }).length,
    0,
  );
  if (!picks.some((id) => !options.ignoredPicks?.has(id)))
    return { ready: false, ranked: [], insufficient: [], shown, ignored };
  const results = Object.values(profiles)
    .filter((p) => p.role === draft.role && !blocked.has(p.id))
    .map((p) => scoreCandidate(p, draft, options));
  const sort = (a: ScoredCandidate, b: ScoredCandidate) =>
    b.score - a.score || a.id - b.id;
  return {
    ready: true,
    ranked: results.filter((x) => x.complete).sort(sort),
    insufficient: results.filter((x) => !x.complete).sort(sort),
    shown,
    ignored,
  };
}
