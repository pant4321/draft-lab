import type {
  Champion,
  Draft,
  Profiles,
  Role,
  Roster,
  ScoreOptions,
} from './types';
import type { ScoredCandidate } from './draft-math';
import type { Blindability } from './blindability';

export type BlindCandidate = Pick<ScoredCandidate, 'id' | 'role' | 'wr'> & {
  score: null;
  counter: null;
  synergy: null;
  pairs: [];
};
export type Candidate = ScoredCandidate | BlindCandidate;
type Ranking = ReturnType<typeof rankDraft>;
export type Recommendation =
  | (Ranking & { mode: 'draft' })
  | (Omit<Ranking, 'ranked'> & {
      mode: 'blindability';
      ranked: BlindCandidate[];
    });

import { rankDraft } from './draft-math';

export function recommendationList(
  draft: Draft,
  profiles: Profiles,
  blindability: Blindability,
  champions: Roster,
  options: ScoreOptions = {},
): Recommendation {
  const ranking = rankDraft(draft, profiles, options);
  if (ranking.ready) return { ...ranking, mode: 'draft' };
  const banned = new Set(draft.bans ?? []);
  const ranked = Object.values(profiles)
    .filter((p) => p.role === draft.role && !banned.has(p.id))
    .map<BlindCandidate>((p) => ({
      id: p.id,
      role: p.role,
      wr: p.wr,
      score: null,
      counter: null,
      synergy: null,
      pairs: [],
    }))
    .sort(
      (a, b) =>
        (blindability[b.id]?.score ?? -1) - (blindability[a.id]?.score ?? -1) ||
        (champions.get(a.id)?.name ?? String(a.id)).localeCompare(
          champions.get(b.id)?.name ?? String(b.id),
        ),
    );
  return { ...ranking, ready: true, mode: 'blindability', ranked };
}

export function sortPickerChampions(champions: Iterable<Champion>, role: Role) {
  return [...champions].sort(
    (a, b) =>
      (b.roles[role]?.pickRate ?? 0) - (a.roles[role]?.pickRate ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export function sortRecommendationRows<
  K extends PropertyKey,
  T extends Record<K, number | null | undefined>,
>(rows: readonly T[], key: K, direction: number) {
  return [...rows].sort((a, b) => {
    const left = a[key],
      right = b[key],
      hasLeft = Number.isFinite(left),
      hasRight = Number.isFinite(right);
    if (!hasLeft || !hasRight) return Number(hasRight) - Number(hasLeft);
    return direction * (Number(left) - Number(right));
  });
}
