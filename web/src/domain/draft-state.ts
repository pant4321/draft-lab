import { emptyPools } from './champion-pool';
import { emptyDraft } from './draft-math';
import {
  cleanRoleOverrides,
  inferDraftRoles,
  moveDraftChampion,
  selectDraftRole,
} from './draft-roles';
import {
  applyMatchSnapshot,
  combineRoleHints,
  mergeClientSnapshot,
} from './draft-sync';
import { defaultMultipliers } from './draft-weights';
import { ROLES } from './types';
import { blankSavedDraft, blockedChampions } from '../services/storage';
import type { SavedDraft } from '../services/storage';
import type {
  ClientSnapshot,
  Multipliers,
  Pools,
  Role,
  RoleDetails,
  RoleOverrides,
  Roster,
  Side,
} from './types';

export type DragSource = { side: Side; role: Role; id: number };
const blankOverrides = (): RoleOverrides => ({ allies: {}, enemies: {} });

export type DraftState = SavedDraft & {
  roster: Roster;
  pools: Pools;
  weights: Multipliers;
  roleDetails: RoleDetails;
  clientSession: string | null;
  clientRoleOverride: Role | null;
  clientOwnChampion: number | null;
  clientHints: RoleOverrides;
  syncing: boolean;
  drag: DragSource | null;
  queuedSnapshot: ClientSnapshot | null;
  notice: string;
};

export type DraftAction =
  | {
      type: 'roster';
      roster: Roster;
      restored?: { saved: SavedDraft; pools: Pools; weights: Multipliers };
    }
  | { type: 'pick'; side: Side; role: Role; id: number | null }
  | { type: 'ban' | 'ignore'; id: number }
  | { type: 'role'; role: Role; preview: number | null }
  | { type: 'select'; id: number | null; inherited?: boolean }
  | { type: 'reset' | 'clearCorrections' }
  | { type: 'autoRoles' | 'includeStrength'; enabled: boolean }
  | { type: 'weights'; weights: Multipliers }
  | { type: 'pool'; role: Role; id?: number }
  | { type: 'dragStart'; source: DragSource }
  | { type: 'dragFinish'; destination: Role | null }
  | {
      type: 'companion';
      enabled: boolean;
      syncing: boolean;
      snapshot?: ClientSnapshot;
    };

export function initialDraftState(): DraftState {
  return {
    ...blankSavedDraft(),
    roster: new Map(),
    pools: emptyPools(),
    weights: defaultMultipliers(),
    roleDetails: { allies: {}, enemies: {} },
    clientSession: null,
    clientRoleOverride: null,
    clientOwnChampion: null,
    clientHints: blankOverrides(),
    syncing: false,
    drag: null,
    queuedSnapshot: null,
    notice: '',
  };
}

function reconcile(state: DraftState): DraftState {
  const roleOverrides = cleanRoleOverrides(state.draft, state.roleOverrides);
  const result = state.autoRoles
    ? inferDraftRoles(
        state.draft,
        state.roster,
        combineRoleHints(state.draft, roleOverrides, state.clientHints),
      )
    : { draft: state.draft, details: { allies: {}, enemies: {} } };
  const revealed = [
    ...Object.values(result.draft.allies),
    ...Object.values(result.draft.enemies),
  ];
  const selected = blockedChampions(result.draft).includes(state.selected)
    ? null
    : state.selected;
  return {
    ...state,
    draft: result.draft,
    roleDetails: result.details,
    roleOverrides,
    selected,
    inheritedSelection: selected !== null && state.inheritedSelection,
    ignoredPicks: state.ignoredPicks.filter((id) => revealed.includes(id)),
  };
}

function importSnapshot(
  state: DraftState,
  snapshot: ClientSnapshot,
): DraftState {
  if (state.drag) return { ...state, queuedSnapshot: snapshot };
  const newSession = state.clientSession !== snapshot.sessionId;
  const clientRoleOverride =
    newSession || snapshot.phase === 'game' ? null : state.clientRoleOverride;
  const result = snapshot.phase === 'game'
    ? applyMatchSnapshot(
        snapshot,
        state.roster,
        newSession ? {} : state.roleOverrides,
      )
    : mergeClientSnapshot(state.draft, snapshot, state.roster, {
        overrides: state.roleOverrides,
        newSession,
        roleOverride: clientRoleOverride,
      });
  return reconcile({
    ...state,
    draft: result.draft,
    roleOverrides: result.overrides,
    clientHints: result.hints,
    clientOwnChampion: result.ownChampion,
    clientSession: snapshot.sessionId,
    clientRoleOverride,
    autoRoles: true,
    ignoredPicks: newSession ? [] : state.ignoredPicks,
    notice: result.unknown.length
      ? 'Some champions are missing from this snapshot'
      : '',
  });
}

export function draftReducer(
  state: DraftState,
  action: DraftAction,
): DraftState {
  switch (action.type) {
    case 'roster': {
      const { restored, roster } = action;
      return reconcile({
        ...state,
        ...restored?.saved,
        roster,
        pools: restored?.pools ?? state.pools,
        weights: restored?.weights ?? state.weights,
      });
    }
    case 'pick': {
      const old = state.draft[action.side][action.role];
      if (
        old === action.id ||
        (action.side === 'allies' && action.role === state.draft.role)
      )
        return state;
      if (
        action.id !== null &&
        (!state.roster.has(action.id) ||
          blockedChampions(state.draft).includes(action.id))
      )
        return state;
      const pins = { ...state.roleOverrides[action.side] };
      if (old !== null) delete pins[old];
      return reconcile({
        ...state,
        draft: {
          ...state.draft,
          [action.side]: {
            ...state.draft[action.side],
            [action.role]: action.id,
          },
        },
        roleOverrides: { ...state.roleOverrides, [action.side]: pins },
        notice: '',
      });
    }
    case 'ban': {
      const { draft } = state;
      if (
        !state.roster.has(action.id) ||
        Object.values(draft.allies).includes(action.id) ||
        Object.values(draft.enemies).includes(action.id)
      )
        return state;
      const bans = draft.bans.includes(action.id)
        ? draft.bans.filter((id) => id !== action.id)
        : [...draft.bans, action.id];
      return reconcile({ ...state, draft: { ...draft, bans }, notice: '' });
    }
    case 'ignore': {
      const ignoredPicks = state.ignoredPicks.includes(action.id)
        ? state.ignoredPicks.filter((id) => id !== action.id)
        : [...state.ignoredPicks, action.id];
      return reconcile({ ...state, ignoredPicks });
    }
    case 'role': {
      if (action.role === state.draft.role) return state;
      const preview = blockedChampions(state.draft).includes(action.preview)
        ? null
        : action.preview;
      const result = selectDraftRole(state.draft, action.role, {
        preview,
        overrides: state.roleOverrides,
      });
      return reconcile({
        ...state,
        draft: result.draft,
        selected: result.selected,
        roleOverrides: result.overrides,
        inheritedSelection: result.selected !== null,
        clientOwnChampion: null,
        clientHints: blankOverrides(),
        clientRoleOverride: action.role,
        queuedSnapshot: null,
        notice: '',
      });
    }
    case 'select':
      return state.selected === action.id &&
        state.inheritedSelection === Boolean(action.inherited)
        ? state
        : {
            ...state,
            selected: action.id,
            inheritedSelection: Boolean(action.inherited),
          };
    case 'reset':
      return reconcile({
        ...state,
        draft: emptyDraft(state.draft.role),
        ignoredPicks: [],
        roleOverrides: blankOverrides(),
        selected: null,
        inheritedSelection: false,
        clientOwnChampion: null,
        notice: '',
      });
    case 'clearCorrections':
      return reconcile({ ...state, roleOverrides: blankOverrides() });
    case 'autoRoles':
      return reconcile({ ...state, autoRoles: action.enabled });
    case 'includeStrength':
      return { ...state, includeStrength: action.enabled };
    case 'weights':
      return { ...state, weights: action.weights };
    case 'pool': {
      const pool = state.pools[action.role];
      const id = action.id;
      const next =
        id === undefined
          ? []
          : pool.includes(id)
            ? pool.filter((champion) => champion !== id)
            : [...pool, id];
      return { ...state, pools: { ...state.pools, [action.role]: next } };
    }
    case 'dragStart':
      return { ...state, drag: action.source, notice: '' };
    case 'dragFinish': {
      const { drag, queuedSnapshot, syncing } = state;
      let next: DraftState = { ...state, drag: null, queuedSnapshot: null };
      if (drag && action.destination && drag.role !== action.destination) {
        if (state.draft[drag.side][drag.role] === drag.id) {
          const moved = moveDraftChampion(
            state.draft,
            drag.side,
            drag.role,
            action.destination,
            state.roleOverrides,
          );
          next = reconcile({
            ...next,
            draft: moved.draft,
            roleOverrides: moved.overrides,
          });
        } else
          next = {
            ...next,
            notice: 'The draft changed. Try moving the champion again.',
          };
      }
      if (!queuedSnapshot || !syncing) return next;
      try {
        return importSnapshot(next, queuedSnapshot);
      } catch {
        return {
          ...next,
          notice:
            'Draft could not be synced. Pause sync to enter picks manually.',
        };
      }
    }
    case 'companion': {
      const next = action.enabled
        ? { ...state, syncing: action.syncing }
        : {
            ...state,
            syncing: false,
            queuedSnapshot: null,
            clientHints: blankOverrides(),
            clientOwnChampion: null,
          };
      if (!action.snapshot || !action.syncing) return next;
      try {
        return importSnapshot(next, action.snapshot);
      } catch {
        return {
          ...next,
          notice:
            'Draft could not be synced. Pause sync to enter picks manually.',
        };
      }
    }
  }
}

export function neededRoles(state: DraftState, side: Side = 'allies') {
  return ROLES.filter((role) => {
    const id = state.draft[side][role];
    return (
      (side === 'allies' && role === state.draft.role) ||
      (id !== null && !state.ignoredPicks.includes(id))
    );
  });
}
