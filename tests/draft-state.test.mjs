import { expect, test } from 'vitest';
import { draftReducer, initialDraftState } from '../web/src/domain/draft-state.ts';
import { readDraft } from '../web/src/services/storage.ts';

const roster = new Map([1, 2, 3, 4].map(id => [id, {
  id, key: String(id), name: String(id),
  roles: { top: { games: 1000, wr: .5 }, middle: { games: 500, wr: .5 } },
}]));
const snapshot = (sessionId, enemies) => ({
  sessionId, allies: [], enemies: enemies.map(id => ({ id, role: null })), bans: [],
  playerRole: 'jungle', playerChampion: 4,
});
const apply = (state, input) => draftReducer(state, { type: 'companion', enabled: true, syncing: true, snapshot: input });

test('old draft records are restored, normalizing invalid entries without losing valid preferences', () => {
  const value = {
    draft: { role: 'jungle', allies: { top: 1 }, enemies: { middle: 2 }, bans: [3] },
    includeStrength: true, autoRoles: true, roleOverrides: { enemies: { 2: 'middle', 3: 'top' } },
    selected: 4, inheritedSelection: true, ignoredPicks: [2, 2, '2', 3, 99],
  };
  const saved = readDraft({ getItem: key => {
    expect(key).toBe('draftlab-draft-v1');
    return JSON.stringify(value);
  } }, roster);
  expect(saved).toMatchObject({ draft: value.draft, includeStrength: true, autoRoles: true,
    roleOverrides: { allies: {}, enemies: { 2: 'middle' } }, selected: 4, inheritedSelection: true, ignoredPicks: [2] });
  expect(readDraft({ getItem: () => '{' }, roster).draft.bans).toEqual([]);
  expect(readDraft({ getItem: () => JSON.stringify({ draft: { ...value.draft, bans: [1] } }) }, roster).selected).toBeNull();
});

test('only the latest snapshot waits for a role swap, and manual pins survive the queued update', () => {
  let state = draftReducer(initialDraftState(), { type: 'roster', roster });
  state = apply(state, snapshot('one', [1, 2]));
  const id = state.draft.enemies.top;
  const other = state.draft.enemies.middle;
  expect(id).not.toBeNull();
  expect(other).not.toBeNull();
  state = draftReducer(state, { type: 'dragStart', source: { side: 'enemies', role: 'top', id } });
  state = apply(state, snapshot('one', [3]));
  state = apply(state, snapshot('one', [1, 2, 3]));
  expect(state.draft.enemies.top).toBe(id);
  expect(state.queuedSnapshot.enemies.map(pick => pick.id)).toEqual([1, 2, 3]);
  state = draftReducer(state, { type: 'dragFinish', destination: 'middle' });
  expect(state.draft.enemies.middle).toBe(id);
  expect(state.draft.enemies.top).toBe(other);
  expect(state.roleOverrides.enemies).toMatchObject({ [id]: 'middle', [other]: 'top' });
  expect(Object.values(state.draft.enemies)).toContain(3);
  expect(state.queuedSnapshot).toBeNull();
});

test('cancelling a drag flushes the queued snapshot, and pausing discards it', () => {
  let state = draftReducer(initialDraftState(), { type: 'roster', roster });
  state = apply(state, snapshot('one', [1]));
  state = draftReducer(state, { type: 'dragStart', source: { side: 'enemies', role: 'top', id: 1 } });
  state = apply(state, snapshot('one', [2]));
  state = draftReducer(state, { type: 'dragFinish', destination: null });
  expect(Object.values(state.draft.enemies)).toContain(2);
  state = draftReducer(state, { type: 'dragStart', source: { side: 'enemies', role: 'top', id: 2 } });
  state = apply(state, snapshot('two', [3]));
  state = draftReducer(state, { type: 'companion', enabled: false, syncing: false });
  state = draftReducer(state, { type: 'dragFinish', destination: null });
  expect(Object.values(state.draft.enemies)).toContain(2);
  expect(Object.values(state.draft.enemies)).not.toContain(3);
  expect(state.queuedSnapshot).toBeNull();
});

test('reported match roles replace conflicting draft corrections and keep same-session exclusions', () => {
  let state = draftReducer(initialDraftState(), { type: 'roster', roster });
  state = apply(state, { ...snapshot('one', [1, 2]), bans: [3] });
  const previousTop = state.draft.enemies.top;
  const previousMid = state.draft.enemies.middle;
  state = draftReducer(state, { type: 'ignore', id: previousTop });
  state = { ...state, clientRoleOverride: 'jungle', roleOverrides: {
    allies: {}, enemies: { [previousTop]: 'top' },
  } };

  const match = {
    phase: 'game', sessionId: 'one', player: { key: '4', role: 'top' }, allies: [],
    enemies: [{ key: String(previousTop), role: 'middle' }, { key: String(previousMid), role: 'top' }],
    bans: [3],
  };
  state = apply(state, match);
  expect(state.draft).toMatchObject({
    role: 'top', enemies: { top: previousMid, middle: previousTop }, bans: [3],
  });
  expect(state.clientOwnChampion).toBe(4);
  expect(state.clientRoleOverride).toBeNull();
  expect(state.roleOverrides.enemies).toEqual({});
  expect(state.ignoredPicks).toEqual([previousTop]);
  state = draftReducer(state, { type: 'ignore', id: previousMid });
  expect(state.draft.enemies.middle).toBe(previousTop);
});
