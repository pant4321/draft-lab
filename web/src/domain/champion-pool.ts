import { byRole, isChampionId, isRecord } from './types';
import type { Pools, Roster } from './types';

export const POOL_STORAGE = 'draftlab-pools-v1';
export function emptyPools() {
  return byRole<number[]>(() => []);
}
export function cleanPools(value: unknown, champions: Roster) {
  return byRole((role) => {
    const ids = isRecord(value) ? value[role] : null;
    return Array.isArray(ids)
      ? [...new Set(ids.filter((id) => isChampionId(id) && champions.has(id)))]
      : [];
  });
}
export function loadPools(storage: Storage, champions: Roster) {
  try {
    return cleanPools(
      JSON.parse(storage.getItem(POOL_STORAGE) ?? 'null'),
      champions,
    );
  } catch {
    return emptyPools();
  }
}
export function savePools(storage: Storage, pools: Pools) {
  try {
    storage.setItem(POOL_STORAGE, JSON.stringify(pools));
    return true;
  } catch {
    return false;
  }
}
export function poolSections<T extends { id: number }>(
  rows: T[],
  pool: readonly number[] = [],
) {
  const ids = new Set(pool);
  if (!ids.size) return [{ key: 'all', title: null, rows }];
  return [
    {
      key: 'pool',
      title: 'Your pool',
      rows: rows.filter((row) => ids.has(row.id)),
    },
    {
      key: 'other',
      title: 'Other champions',
      rows: rows.filter((row) => !ids.has(row.id)),
    },
  ];
}
export function prioritizePool<T extends { id: number }>(
  rows: T[],
  pool: readonly number[] = [],
) {
  return poolSections(rows, pool).flatMap((section) => section.rows);
}
