import { adjustedSamplingRange } from './sampling';
import type { SamplingRange } from './sampling';
import type { Draft, LoadedProfiles, Pair, Role, ScoreOptions, Side } from './types';

type Position = { role: Role; id: number };
type TeamTerm = {
  kind: 'counter' | 'synergy' | 'base';
  from: Position;
  to: Position | null;
  multiplier: number;
  adjusted: number | null;
  weighted: number | null;
};

import {
  ROLES,
  MAX_ROLE_MULTIPLIER,
  pairContribution,
  validateDraft,
} from './draft-math';

function weight(
  multipliers: ScoreOptions['multipliers'],
  side: Side,
  role: Role,
) {
  const value = multipliers?.[side]?.[role] ?? 1;
  if (!Number.isFinite(value) || value < 0 || value > MAX_ROLE_MULTIPLIER)
    throw Error('Invalid team role multiplier.');
  return value;
}

// A team has one term per unordered teammate pair and one per opposing matchup.
export function scoreTeamDraft(
  draft: Draft,
  profiles: LoadedProfiles,
  {
    ownChampion = null,
    side = 'allies',
    priorGames = 1000,
    includeStrength = false,
    multipliers,
    ignoredPicks,
  }: ScoreOptions & { ownChampion?: number | null; side?: Side } = {},
) {
  validateDraft(draft);
  if (!Number.isFinite(priorGames) || priorGames < 0)
    throw Error('Invalid sample adjustment.');
  const allies = { ...draft.allies };
  if (ownChampion != null) {
    if (
      !Number.isInteger(ownChampion) ||
      ownChampion <= 0 ||
      [
        ...Object.values(allies),
        ...Object.values(draft.enemies),
        ...(draft.bans ?? []),
      ].includes(ownChampion)
    )
      throw Error('Invalid own champion for team total.');
    allies[draft.role] = ownChampion;
  }
  const active = (id: number | null): id is number =>
    id != null && !ignoredPicks?.has(id);
  const opposingSide = side === 'allies' ? 'enemies' : 'allies';
  const slots = { allies, enemies: draft.enemies };
  const picks = ROLES.flatMap((role) => {
    const id = slots[side][role];
    return active(id) ? [{ role, id, profile: profiles[role]?.[id] }] : [];
  });
  const opponents = ROLES.flatMap((role) => {
    const id = slots[opposingSide][role];
    return active(id) ? [{ role, id }] : [];
  });
  const terms: TeamTerm[] = [],
    missing: TeamTerm[] = [];
  let counter = 0,
    synergy = 0,
    base = 0,
    ignored = 0;
  let bounds: SamplingRange | null = [0, 0];
  let hasSampledMatchup = false;

  function add(
    kind: TeamTerm['kind'],
    from: Position,
    to: Position | null,
    effect: number | null,
    multiplier: number,
  ) {
    const term = {
      kind,
      from: { role: from.role, id: from.id },
      to: to ? { role: to.role, id: to.id } : null,
      multiplier,
      adjusted: effect,
      weighted:
        multiplier === 0 ? 0 : effect == null ? null : effect * multiplier,
    };
    terms.push(term);
    if (multiplier === 0) ignored++;
    else if (term.weighted == null) missing.push(term);
    else if (kind === 'counter') counter += term.weighted;
    else if (kind === 'synergy') synergy += term.weighted;
    else base += term.weighted;
  }

  function addMatchup(
    kind: 'counter' | 'synergy',
    from: Position,
    to: Position,
    records: readonly (Pair | undefined)[],
    multiplier: number,
  ) {
    const effects = records.flatMap((record) => {
      const pair = pairContribution(record, priorGames);
      return pair ? [{ record, adjusted: pair.adjusted }] : [];
    });
    const count = effects.length;
    add(
      kind,
      from,
      to,
      count ? effects.reduce((sum, pair) => sum + pair.adjusted, 0) / count : null,
      multiplier,
    );
    if (!bounds || multiplier === 0 || !count) return;
    let low = 0;
    let high = 0;
    for (const { record } of effects) {
      const range = adjustedSamplingRange(record, priorGames);
      if (!range) {
        bounds = null;
        return;
      }
      low += range[0];
      high += range[1];
    }
    // Use the same directional average for both bounds as for the score.
    bounds[0] += (low / count) * multiplier;
    bounds[1] += (high / count) * multiplier;
    hasSampledMatchup = true;
  }

  for (let i = 0; i < picks.length; i++) {
    const a = picks[i];
    for (let j = i + 1; j < picks.length; j++) {
      const b = picks[j];
      addMatchup(
        'synergy',
        a,
        b,
        [a.profile?.ally?.[b.role]?.[b.id], b.profile?.ally?.[a.role]?.[a.id]],
        (weight(multipliers, side, a.role) +
          weight(multipliers, side, b.role)) /
          2,
      );
    }
    for (const opponent of opponents) {
      addMatchup(
        'counter',
        a,
        opponent,
        [a.profile?.enemy?.[opponent.role]?.[opponent.id]],
        weight(multipliers, opposingSide, opponent.role),
      );
    }
    if (includeStrength) {
      const wr = a.profile?.wr;
      add(
        'base',
        a,
        null,
        wr !== undefined && Number.isFinite(wr) && wr >= 0 && wr <= 1
          ? 100 * (wr - 0.5)
          : null,
        1,
      );
    }
  }
  const complete = missing.length === 0;
  const sampleRange: SamplingRange | null =
    complete && bounds && hasSampledMatchup
      ? [bounds[0] + base, bounds[1] + base]
      : null;
  return {
    counter: missing.some((t) => t.kind === 'counter') ? null : counter,
    synergy: missing.some((t) => t.kind === 'synergy') ? null : synergy,
    base: missing.some((t) => t.kind === 'base') ? null : base,
    score: complete ? counter + synergy + base : null,
    sampleRange,
    complete,
    missing,
    terms,
    ignored,
    alliedCount: side === 'allies' ? picks.length : opponents.length,
    enemyCount: side === 'enemies' ? picks.length : opponents.length,
    ready: picks.length > 0 && terms.length > 0,
    ownChampion,
  };
}
