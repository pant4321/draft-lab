import { combinePatchCatalogs, combinePatchRole } from '../domain/patch-stats';
import { isRecord, ROLES } from '../domain/types';
import type { Champion, LoadedProfiles, Profiles, Role } from '../domain/types';

const files = ['catalog.json', ...ROLES.map((role) => role + '.json')];
const hashPattern = /^[a-f0-9]{64}$/;
const patchPattern = /^[1-9]\d*\.[1-9]\d*$/;
type Checksums = Record<string, string>;
type PatchInput = { patch: string; base: string; files: Checksums };
export type DatasetEntry = {
  id: string;
  base: string;
  label: string;
  rank?: string;
  kind: 'combined' | 'historical';
  files: Checksums;
  patches?: string[];
  patchInputs?: PatchInput[];
};
export type Catalog = {
  rank: string;
  patches: string[];
  asOf: string;
  champions: Champion[];
  profileCounts?: unknown;
  candidateFloorRolePercent?: number;
  components?: { patch: string; base: string; snapshotSha256: string }[];
};
export type DatasetSelection = {
  entry: DatasetEntry;
  catalog: Catalog;
  roster?: Champion[];
  patches: string[];
  role: (role: Role) => Promise<Profiles>;
};
export type ActiveDataset = DatasetSelection & { profiles: LoadedProfiles };

const dataPath = (base: unknown): base is string =>
  typeof base === 'string' &&
  /^data\/[\w./-]+$/.test(base) &&
  !base.split('/').some((part) => !part || part === '.' || part === '..');
const isHash = (value: unknown): value is string =>
  typeof value === 'string' && hashPattern.test(value);
const completeFiles = (checksums: unknown): checksums is Checksums =>
  isRecord(checksums) && files.every((file) => isHash(checksums[file]));

export class DatasetStore {
  readonly entries = new Map<string, DatasetEntry>();
  readonly defaultId: string;
  private requests = new Map<string, Promise<unknown>>();

  constructor(
    manifest: unknown,
    private fetcher = fetch.bind(globalThis),
  ) {
    if (
      !isRecord(manifest) ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.datasets) ||
      !manifest.datasets.length
    )
      throw Error('Invalid dataset index.');
    for (const entry of manifest.datasets) {
      if (
        !isRecord(entry) ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        this.entries.has(entry.id) ||
        !dataPath(entry.base) ||
        (entry.kind !== 'combined' && entry.kind !== 'historical') ||
        !completeFiles(entry.files)
      )
        throw Error('Invalid dataset entry.');
      const patches = entry.patches;
      if (
        patches !== undefined &&
        (!Array.isArray(patches) ||
          new Set(patches).size !== patches.length ||
          patches.some(
            (patch) => typeof patch !== 'string' || !patchPattern.test(patch),
          ))
      )
        throw Error('Invalid patch list.');
      if (
        entry.patchInputs !== undefined &&
        (!Array.isArray(entry.patchInputs) ||
          !Array.isArray(patches) ||
          entry.patchInputs.length !== patches.length ||
          entry.patchInputs.some(
            (input, index) =>
              !isRecord(input) ||
              input.patch !== patches[index] ||
              !dataPath(input.base) ||
              !completeFiles(input.files),
          ))
      ) {
        throw Error('Invalid patch data index.');
      }
      this.entries.set(entry.id, entry as DatasetEntry);
    }
    if (
      typeof manifest.default !== 'string' ||
      !this.entries.has(manifest.default)
    ) {
      throw Error('Default dataset is missing.');
    }
    this.defaultId = manifest.default;
  }

  entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw Error('Unknown dataset.');
    return entry;
  }

  async load(id: string, file: string) {
    const entry = this.entry(id);
    if (!files.includes(file)) throw Error('Unknown dataset file.');
    return this.loadFile(entry.base, file, entry.files[file]);
  }

  private async loadFile(
    base: string,
    file: string,
    expected: string,
    retain = true,
  ) {
    const key = `${base}/${file}?v=${expected}`;
    const existing = this.requests.get(key);
    if (existing) return existing;
    const request = (async () => {
      const response = await this.fetcher(key);
      if (!response.ok) throw Error('Dataset could not be loaded.');
      const bytes = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      if (hash !== expected)
        throw Error(
          'Dataset changed or is incomplete. Reload the page to get the latest snapshot.',
        );
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    })().then(
      (value) => {
        if (!retain) this.requests.delete(key);
        return value;
      },
      (error) => {
        this.requests.delete(key);
        throw error;
      },
    );
    this.requests.set(key, request);
    return request;
  }

  async catalog(id: string) {
    const value = await this.load(id, 'catalog.json');
    if (
      !isRecord(value) ||
      !Array.isArray(value.champions) ||
      !value.profileCounts
    ) {
      throw Error('Champion data is incomplete.');
    }
    return value as Catalog;
  }

  async role(id: string, role: Role) {
    if (!ROLES.includes(role)) throw Error('Unknown role.');
    return this.readProfiles(await this.load(id, role + '.json'));
  }

  private readProfiles(value: unknown): Profiles {
    if (!isRecord(value) || !isRecord(value.profiles))
      throw Error('Matchup data is incomplete.');
    return value.profiles as Profiles;
  }

  async select(
    id: string,
    exclusions: readonly string[] = [],
  ): Promise<DatasetSelection> {
    const entry = this.entry(id);
    const catalog = await this.catalog(id);
    const available = entry.patches ?? [];
    const selected = available.filter((patch) => !exclusions.includes(patch));
    if (!selected.length || selected.length === available.length) {
      return {
        entry,
        catalog,
        patches: available,
        role: (role) => this.role(id, role),
      };
    }

    const inputs = await Promise.all(
      selected.map(async (patch) => {
        const published = entry.patchInputs?.find(
          (input) => input.patch === patch,
        );
        if (published) return published;
        const component = catalog.components?.find(
          (value) => value.patch === patch,
        );
        if (
          !component ||
          !dataPath(component.base) ||
          !isHash(component.snapshotSha256)
        ) {
          throw Error('Patch stats are unavailable.');
        }
        const snapshot = await this.loadFile(
          component.base,
          'snapshot.json',
          component.snapshotSha256,
        );
        if (
          !isRecord(snapshot) ||
          snapshot.kind !== 'patch' ||
          snapshot.patch !== patch ||
          !completeFiles(snapshot.files)
        )
          throw Error('Patch manifest is incomplete.');
        return { patch, base: component.base, files: snapshot.files };
      }),
    );
    const catalogs = await Promise.all(
      inputs.map(async (input) => {
        const value = await this.loadFile(
          input.base,
          'catalog.json',
          input.files['catalog.json'],
        );
        if (
          !isRecord(value) ||
          value.patch !== input.patch ||
          value.rank !== entry.rank ||
          !Array.isArray(value.champions) ||
          typeof value.asOf !== 'string' ||
          !Number.isFinite(Date.parse(value.asOf))
        )
          throw Error('Patch champion data is incomplete.');
        return value as Catalog;
      }),
    );
    const champions = combinePatchCatalogs(catalogs);
    const asOf = catalogs.reduce(
      (latest, value) =>
        Date.parse(value.asOf) > Date.parse(latest) ? value.asOf : latest,
      catalogs[0].asOf,
    );

    return {
      entry,
      patches: selected,
      roster: catalog.champions,
      catalog: {
        rank: catalog.rank,
        patches: selected,
        asOf,
        champions: [...champions.values()].sort(
          (left, right) => left.id - right.id,
        ),
      },
      role: async (role) => {
        if (!ROLES.includes(role)) throw Error('Unknown role.');
        const file = role + '.json';
        const parts = await Promise.all(
          inputs.map(async (input) =>
            this.readProfiles(
              await this.loadFile(input.base, file, input.files[file], false),
            ),
          ),
        );
        return combinePatchRole(
          parts,
          champions,
          role,
          catalog.candidateFloorRolePercent ?? 0.5,
        );
      },
    };
  }
}

export async function readDatasetIndex() {
  const response = await fetch('data/datasets.json', { cache: 'no-store' });
  if (!response.ok) throw Error('Dataset index could not be loaded.');
  return new DatasetStore(await response.json());
}
