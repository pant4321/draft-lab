import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { roleBlindability } from './domain/blindability';
import { prioritizePool } from './domain/champion-pool';
import { recommendationList } from './domain/draft-list';
import {
  draftReducer,
  initialDraftState,
  neededRoles,
} from './domain/draft-state';
import type { DraftAction } from './domain/draft-state';
import type { Champion, LoadedProfiles, Role, Roster } from './domain/types';
import { initialCompanionState } from './services/companion';
import type { CompanionClient, CompanionConnector } from './services/companion';
import { readDatasetIndex } from './services/datasets';
import type { DatasetSelection, DatasetStore } from './services/datasets';
import {
  readExcludedPatches,
  readPreferences,
  writeExcludedPatches,
  writePreferences,
} from './services/storage';

type DatasetRequest = { generation: number; id?: string; exclusions: string[] };
type ActiveData = { selection: DatasetSelection; profiles: LoadedProfiles };
type ProfileRequests = Map<Role, Promise<NonNullable<LoadedProfiles[Role]>>>;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Data unavailable.';

function mergeRoster(selection: DatasetSelection, previous: Roster) {
  const roster = new Map<number, Champion>();
  for (const champion of [...previous.values(), ...(selection.roster ?? [])]) {
    roster.set(champion.id, { ...champion, roles: {} });
  }
  for (const champion of selection.catalog.champions)
    roster.set(champion.id, champion);
  return roster;
}

export function useDraftLab(connect: CompanionConnector | null) {
  const [state, dispatch] = useReducer(
    draftReducer,
    undefined,
    initialDraftState,
  );
  const [request, setRequest] = useState<DatasetRequest>(() => ({
    generation: 0,
    exclusions: readExcludedPatches(),
  }));
  const [data, setData] = useState<ActiveData | null>(null);
  const [entries, setEntries] = useState<DatasetStore['entries'] | null>(null);
  const [pending, setPending] = useState(true);
  const [datasetError, setDatasetError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [companionState, setCompanionState] = useState(initialCompanionState);
  const companion = useRef<CompanionClient | null>(null);
  const currentGeneration = useRef(0);
  const index = useRef<Promise<DatasetStore> | null>(null);
  const latest = useRef({ state, data });
  const profileRequests = useRef(
    new WeakMap<DatasetSelection, ProfileRequests>(),
  );
  const exclusions = useMemo(
    () =>
      (data?.selection.entry.patches ?? []).filter(
        (patch) => !data?.selection.patches.includes(patch),
      ),
    [data?.selection],
  );

  useLayoutEffect(() => {
    latest.current = { state, data };
  }, [state, data]);

  function loadProfile(selection: DatasetSelection, role: Role) {
    let requests = profileRequests.current.get(selection);
    if (!requests) {
      requests = new Map();
      profileRequests.current.set(selection, requests);
    }
    const cache = requests;
    let promise = cache.get(role);
    if (!promise) {
      promise = selection.role(role).catch((error) => {
        cache.delete(role);
        throw error;
      });
      cache.set(role, promise);
    }
    return promise;
  }

  useEffect(() => {
    let alive = true;
    const current = () =>
      alive && request.generation === currentGeneration.current;

    async function prepare(store: DatasetStore, requestedExclusions: string[]) {
      const selection = await store.select(
        request.id ?? store.defaultId,
        requestedExclusions,
      );
      if (!current()) return;
      const roster = mergeRoster(selection, latest.current.state.roster);
      const restored = latest.current.data
        ? undefined
        : readPreferences(roster);
      const rosterAction = { type: 'roster', roster, restored } as const;
      const profiles: LoadedProfiles = {};
      while (current()) {
        const roles = neededRoles(
          draftReducer(latest.current.state, rosterAction),
        ).filter((role) => !profiles[role]);
        if (!roles.length) return { selection, profiles, rosterAction };
        const loaded = await Promise.all(
          roles.map(
            async (role) => [role, await loadProfile(selection, role)] as const,
          ),
        );
        for (const [role, profile] of loaded) profiles[role] = profile;
      }
    }

    async function load() {
      try {
        const store = await (index.current ??= readDatasetIndex());
        if (!current()) return;
        setEntries(store.entries);
        let result;
        try {
          result = await prepare(store, request.exclusions);
        } catch (error) {
          if (!current()) return;
          if (latest.current.data || !request.exclusions.length) throw error;
          result = await prepare(store, []);
        }
        if (!current() || !result) return;
        const { selection, profiles, rosterAction } = result;
        dispatch(rosterAction);
        setData({ selection, profiles });
        setProfileError('');
        writeExcludedPatches(
          (selection.entry.patches ?? []).filter(
            (patch) => !selection.patches.includes(patch),
          ),
        );
      } catch (error) {
        if (!current()) return;
        setDatasetError(
          latest.current.data
            ? 'Could not load the requested dataset. ' + errorMessage(error)
            : errorMessage(error),
        );
      } finally {
        if (current()) setPending(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [request]);

  useEffect(() => {
    if (!data || pending) return;
    const missing = neededRoles(state).filter((role) => !data.profiles[role]);
    let alive = true;
    if (!missing.length) {
      setProfileError('');
      return;
    }
    setProfileError('');
    void Promise.all(
      missing.map(
        async (role) =>
          [role, await loadProfile(data.selection, role)] as const,
      ),
    ).then(
      (loaded) => {
        if (!alive) return;
        setData((previous) =>
          previous?.selection === data.selection
            ? {
                ...previous,
                profiles: {
                  ...previous.profiles,
                  ...Object.fromEntries(loaded),
                },
              }
            : previous,
        );
      },
      (error) => {
        if (alive) setProfileError(errorMessage(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [data, pending, state.draft, state.ignoredPicks]);

  const initialized = data !== null;
  useEffect(() => {
    if (!connect || !initialized) return;
    const client = connect((next, snapshot) => {
      setCompanionState(next);
      dispatch({
        type: 'companion',
        enabled: next.connected && !next.paused,
        syncing: next.syncing,
        snapshot,
      });
    });
    companion.current = client;
    void client.start();
    return () => {
      client.dispose();
      companion.current = null;
    };
  }, [connect, initialized]);

  const {
    draft,
    ignoredPicks: ignored,
    includeStrength,
    weights,
    roster,
    pools,
  } = state;
  const ignoredPicks = useMemo(() => new Set(ignored), [ignored]);
  const options = useMemo(
    () => ({ ignoredPicks, includeStrength, multipliers: weights }),
    [ignoredPicks, includeStrength, weights],
  );
  const roleProfiles = data?.profiles[draft.role];
  const catalog = data?.selection.catalog;
  const blind = useMemo(
    () =>
      roleProfiles && catalog
        ? roleBlindability(roleProfiles, catalog.champions)
        : {},
    [roleProfiles, catalog],
  );
  const pool = pools[draft.role];
  const ranking = useMemo(() => {
    if (!roleProfiles) return null;
    const result = recommendationList(
      draft,
      roleProfiles,
      blind,
      roster,
      options,
    );
    return result.mode === 'draft'
      ? { ...result, ranked: prioritizePool(result.ranked, pool) }
      : { ...result, ranked: prioritizePool(result.ranked, pool) };
  }, [draft, roleProfiles, blind, roster, options, pool]);

  const selected =
    ranking &&
    !state.inheritedSelection &&
    !ranking.ranked.some((row) => row.id === state.selected)
      ? ranking.mode === 'draft'
        ? (ranking.ranked[0]?.id ?? null)
        : null
      : state.selected;

  useEffect(() => {
    if (ranking && !pending && selected !== state.selected)
      dispatch({ type: 'select', id: selected });
  }, [ranking, pending, selected, state.selected]);

  const { autoRoles, roleOverrides, inheritedSelection } = state;
  useEffect(() => {
    if (initialized)
      writePreferences(
        {
          draft,
          includeStrength,
          autoRoles,
          roleOverrides,
          selected,
          inheritedSelection,
          ignoredPicks: ignored,
        },
        pools,
        weights,
      );
  }, [
    initialized,
    draft,
    includeStrength,
    autoRoles,
    roleOverrides,
    selected,
    inheritedSelection,
    ignored,
    pools,
    weights,
  ]);

  function requestDataset(
    id: string,
    nextExclusions = pending ? request.exclusions : exclusions,
  ) {
    const generation = ++currentGeneration.current;
    setPending(true);
    setDatasetError('');
    setRequest({ generation, id, exclusions: nextExclusions });
  }

  function manual(action?: DraftAction) {
    if (state.syncing) companion.current?.pause();
    if (action) dispatch(action);
  }

  return {
    state,
    dispatch,
    manual,
    data,
    entries,
    pending,
    datasetError,
    profileError,
    companion,
    companionState,
    requestDataset,
    requestedDatasetId: pending ? request.id : undefined,
    exclusions,
    initialized,
    options,
    roleProfiles,
    blind,
    ranking,
    selected,
    catalog,
  };
}

export type DraftLab = ReturnType<typeof useDraftLab>;
