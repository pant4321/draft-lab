import { emptyPools, loadPools, savePools } from '../domain/champion-pool';
import { emptyDraft, validateDraft } from '../domain/draft-math';
import { cleanRoleOverrides } from '../domain/draft-roles';
import {
  defaultMultipliers,
  loadMultipliers,
  saveMultipliers,
} from '../domain/draft-weights';
import { isChampionId, isRecord } from '../domain/types';
import type {
  Draft,
  Multipliers,
  Pools,
  RoleOverrides,
  Roster,
} from '../domain/types';
import type { FlashPosition } from './champion-builds';

const DRAFT_STORAGE = 'draftlab-draft-v1';
const PATCH_STORAGE = 'draftlab-excluded-patches-v1';
const FLASH_STORAGE = 'draftlab-flash-position-v1';

export function readFlashPosition(): FlashPosition | null {
  try {
    const value = localStorage.getItem(FLASH_STORAGE);
    return value === 'left' || value === 'right' ? value : null;
  } catch {
    return null;
  }
}

export function writeFlashPosition(position: FlashPosition | null) {
  try {
    if (position) localStorage.setItem(FLASH_STORAGE, position);
    else localStorage.removeItem(FLASH_STORAGE);
  } catch {
    /* Storage is optional. */
  }
}
export type SavedDraft = {
  draft: Draft;
  includeStrength: boolean;
  autoRoles: boolean;
  roleOverrides: RoleOverrides;
  selected: number | null;
  inheritedSelection: boolean;
  ignoredPicks: number[];
};

export function blankSavedDraft(): SavedDraft {
  return {
    draft: emptyDraft(),
    includeStrength: false,
    autoRoles: false,
    roleOverrides: { allies: {}, enemies: {} },
    selected: null,
    inheritedSelection: false,
    ignoredPicks: [],
  };
}

export function blockedChampions(draft: Draft) {
  return [
    ...Object.values(draft.allies),
    ...Object.values(draft.enemies),
    ...draft.bans,
  ];
}

export function readDraft(storage: Storage, roster: Roster): SavedDraft {
  try {
    const value: unknown = JSON.parse(storage.getItem(DRAFT_STORAGE) ?? 'null');
    if (!isRecord(value) || !value.draft) return blankSavedDraft();
    const draft = validateDraft(value.draft);
    const blocked = blockedChampions(draft);
    if (blocked.some((id) => id !== null && !roster.has(id)))
      return blankSavedDraft();
    const revealed = [
      ...Object.values(draft.allies),
      ...Object.values(draft.enemies),
    ];
    const selected =
      isChampionId(value.selected) &&
      roster.has(value.selected) &&
      !blocked.includes(value.selected)
        ? value.selected
        : null;
    return {
      draft,
      selected,
      includeStrength: Boolean(value.includeStrength),
      autoRoles: Boolean(value.autoRoles),
      roleOverrides: cleanRoleOverrides(draft, value.roleOverrides),
      inheritedSelection:
        selected !== null && Boolean(value.inheritedSelection),
      ignoredPicks: Array.isArray(value.ignoredPicks)
        ? [
            ...new Set(
              value.ignoredPicks.filter(
                (id) => isChampionId(id) && revealed.includes(id),
              ),
            ),
          ]
        : [],
    };
  } catch {
    return blankSavedDraft();
  }
}

export function readPreferences(roster: Roster) {
  try {
    const storage = globalThis.localStorage;
    return {
      saved: readDraft(storage, roster),
      pools: loadPools(storage, roster),
      weights: loadMultipliers(storage),
    };
  } catch {
    return {
      saved: blankSavedDraft(),
      pools: emptyPools(),
      weights: defaultMultipliers(),
    };
  }
}

export function readExcludedPatches() {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PATCH_STORAGE) ?? 'null',
    );
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (patch) =>
                typeof patch === 'string' && /^[1-9]\d*\.[1-9]\d*$/.test(patch),
            ) as string[],
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

export function writeExcludedPatches(exclusions: readonly string[]) {
  try {
    localStorage.setItem(PATCH_STORAGE, JSON.stringify(exclusions));
  } catch {
    /* Storage is optional. */
  }
}

export function writePreferences(
  saved: SavedDraft,
  pools: Pools,
  weights: Multipliers,
) {
  try {
    const storage = globalThis.localStorage;
    storage.setItem(DRAFT_STORAGE, JSON.stringify(saved));
    savePools(storage, pools);
    saveMultipliers(storage, weights);
  } catch {
    /* Manual drafting remains available with storage disabled. */
  }
}
