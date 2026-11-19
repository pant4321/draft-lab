export const ROLES = ['top', 'jungle', 'middle', 'bottom', 'support'] as const;
export const SIDES = ['allies', 'enemies'] as const;
export const PAIR_KINDS = ['enemy', 'ally'] as const;
export type Role = (typeof ROLES)[number];
export type Side = (typeof SIDES)[number];
export type PairKind = (typeof PAIR_KINDS)[number];
export type ChampionId = number;
export type RoleMap<T> = Record<Role, T>;
export type Slots = RoleMap<ChampionId | null>;
export type Draft = {
  role: Role;
  allies: Slots;
  enemies: Slots;
  bans: ChampionId[];
};
export type RoleOverrides = Record<Side, Record<ChampionId, Role>>;
export type RoleDetails = Record<
  Side,
  Record<
    ChampionId,
    {
      role: Role;
      manual: boolean;
      alternatives: Role[];
      unsupported: boolean;
    }
  >
>;
export type Pools = RoleMap<ChampionId[]>;
export type Multipliers = Record<Side, RoleMap<number>>;
export type RoleStats = { games: number; wr: number; pickRate?: number };
export type Champion = {
  id: ChampionId;
  key: string;
  name: string;
  roles: Partial<RoleMap<RoleStats>>;
};
export type Roster = ReadonlyMap<ChampionId, Champion>;
export type Pair = readonly [delta: number, games: number, winRate?: number];
export type PairTable = Record<ChampionId, Pair>;
export type Profile = {
  id: ChampionId;
  role: Role;
  wr: number;
  games: number;
  enemy?: Partial<RoleMap<PairTable>>;
  ally?: Partial<RoleMap<PairTable>>;
};
export type Profiles = Record<ChampionId, Profile>;
export type LoadedProfiles = Partial<RoleMap<Profiles>>;
export type ScoreOptions = {
  priorGames?: number;
  includeStrength?: boolean;
  multipliers?: Partial<Record<Side, Partial<RoleMap<number>>>>;
  ignoredPicks?: ReadonlySet<ChampionId>;
};
export type ScoredPair = {
  side: Side;
  kind: PairKind;
  role: Role;
  id: ChampionId;
  raw: number | null;
  games: number;
  adjusted: number | null;
  multiplier: number;
  weighted: number | null;
  ignoredPick?: boolean;
};
export type ClientPick = { id: ChampionId; role: Role | null };
export type ClientSnapshot = {
  sessionId: string;
  playerChampion: ChampionId | null;
  playerRole: Role | null;
  allies: ClientPick[];
  enemies: ClientPick[];
  bans: ChampionId[];
};
export function isRole(value: unknown): value is Role {
  return ROLES.some((role) => role === value);
}
export function isChampionId(value: unknown): value is ChampionId {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function byRole<T>(value: (role: Role) => T): RoleMap<T> {
  return Object.fromEntries(
    ROLES.map((role) => [role, value(role)]),
  ) as RoleMap<T>;
}
