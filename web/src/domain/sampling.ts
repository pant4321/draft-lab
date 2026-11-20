import { pairContribution } from './draft-math';
import type { ScoredCandidate } from './draft-math';
import type { Pair, Profile, ScoredPair } from './types';

export type SamplingRange = [low: number, high: number];

export function samplingRange(pair: Pair | undefined): SamplingRange | null {
  const [delta, games, observed] = pair ?? [];
  if (
    delta === undefined ||
    games === undefined ||
    observed === undefined ||
    !Number.isFinite(delta) ||
    !Number.isInteger(games) ||
    games <= 0 ||
    !Number.isFinite(observed) ||
    observed < 0 ||
    observed > 1
  )
    return null;
  const expected = observed - delta / 100;
  if (expected < 0 || expected > 1) return null;
  // Wilson interval for the observed rate, shifted by the fixed expected rate.
  const z = 1.96,
    scale = 1 + (z * z) / games;
  const center = (observed + (z * z) / (2 * games)) / scale;
  const radius =
    (z *
      Math.sqrt(
        (observed * (1 - observed)) / games + (z * z) / (4 * games * games),
      )) /
    scale;
  return [
    100 * (Math.max(0, center - radius) - expected),
    100 * (Math.min(1, center + radius) - expected),
  ];
}

export function adjustedSamplingRange(
  pair: Pair | undefined,
  priorGames?: number,
): SamplingRange | null {
  const range = samplingRange(pair);
  if (!pair || !range) return null;
  const games = pair[1];
  return [
    pairContribution([range[0], games], priorGames)!.adjusted,
    pairContribution([range[1], games], priorGames)!.adjusted,
  ];
}

export function contributionSamplingRange(
  pair: ScoredPair,
  profile?: Profile,
  priorGames?: number,
): SamplingRange | null {
  if (!Number.isFinite(pair.weighted)) return null;
  const range = adjustedSamplingRange(
    profile?.[pair.kind]?.[pair.role]?.[pair.id],
    priorGames,
  );
  return range
    ? [range[0] * pair.multiplier, range[1] * pair.multiplier]
    : null;
}

export function draftSamplingOffsets(row: ScoredCandidate, profile?: Profile) {
  const pairs = row.pairs.filter((pair) => pair.multiplier > 0);
  if (!row.complete || !pairs.length) return null;
  let down = 0,
    up = 0;
  for (const pair of pairs) {
    const range = contributionSamplingRange(pair, profile, row.priorGames);
    if (!range || pair.weighted == null) return null;
    down += pair.weighted - range[0];
    up += range[1] - pair.weighted;
  }
  // Let the matchup estimates move together to their low or high bounds.
  return { down: Math.max(0, down), up: Math.max(0, up) };
}
