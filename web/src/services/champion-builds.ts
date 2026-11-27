import type { Role } from '../domain/types';
import { reconnectCompanion } from './companion-session';

export const ITEM_SECTIONS = [
  ['startSet', 'Starting items'],
  ['boots', 'Boots'],
  ['builtBootSet3', 'Core build'],
  ['item1', 'First item'],
  ['item2', 'Second item'],
  ['item4', 'Fourth item'],
  ['item5', 'Fifth item'],
  ['item6', 'Sixth item'],
] as const;

export type Stats = { winRate: number; games: number };
export const NO_BOOTS = 'no-boots';
export type BuildOption = Stats & { key: string; pickRate?: number };
export type RunePage = Stats & {
  kind: 'pick' | 'win';
  statsFor?: 'page';
  primary: number[];
  secondary: number[];
  shards: number[];
};
export type RuneLoadout = Pick<RunePage, 'primary' | 'secondary' | 'shards'>;
export type FlashPosition = 'left' | 'right';
export type SpellPairIds = [number, number];
export type BuildLoadout = { runes: RuneLoadout | null; spells: SpellPairIds | null };

export function summonerSpellIds(key: string | undefined, flashPosition: FlashPosition | null): SpellPairIds | null {
  if (!key || !/^[1-9]\d?_[1-9]\d?$/.test(key)) return null;
  const [left, right] = key.split('_').map(Number);
  if (left === right) return null;
  return (flashPosition === 'left' && right === 4) || (flashPosition === 'right' && left === 4)
    ? [right, left] : [left, right];
}
export type RuneStats = Record<number, Stats & { pickRate: number }>;
type ItemSlot = (typeof ITEM_SECTIONS)[number][0];
export type BuildDecision = ItemSlot | 'keystone' | 'summoners';
export type DraftChange = {
  usual: BuildOption | null;
  option?: BuildOption;
  window?: string;
  generalPickShare: number;
  opponents: (Stats & { opponentId: number; pickShare: number; contribution: number })[];
};

export type ChampionBuild = Stats & {
  runes: RunePage[];
  runeStats?: Record<'primary' | 'secondary', RuneStats>;
  items: Record<ItemSlot, BuildOption[]>;
  coreSteps: BuildOption[];
  opponentId: number | null;
  summoners: BuildOption | null;
  summonerAlternatives?: BuildOption[];
  maxOrder: BuildOption | null;
  levelOrder: BuildOption | null;
  legendarySlots?: boolean;
  window?: string;
  windows?: Partial<Record<BuildDecision, string>>;
  draft?: {
    opponentIds: number[];
    changes: Partial<Record<BuildDecision, DraftChange>>;
    alternatives?: Partial<Record<BuildDecision, Record<string, DraftChange>>>;
  };
};

export type BuildOpponent = { id: number; key: string; name: string; role: Role };
export type BuildSelection = {
  id: number;
  key: string;
  role: Role;
  tier: 'all' | 'emerald_plus';
  opponent: BuildOpponent | null;
  draft: BuildOpponent[];
};

const slugFor = (key: string) => key === 'MonkeyKing' ? 'wukong' : key.toLowerCase();

export function championBuildQuery(selection: BuildSelection) {
  const { id, key, role, tier, opponent, draft } = selection;
  const query = new URLSearchParams({ slug: slugFor(key), id: String(id), role, tier });
  if (opponent) {
    query.set('opponent', slugFor(opponent.key));
    query.set('opponentId', String(opponent.id));
    query.set('opponentRole', opponent.role);
  } else if (draft.length) {
    query.set('draft', draft.map((enemy) => [slugFor(enemy.key), enemy.id, enemy.role].join(':')).join(','));
  }
  return query.toString();
}

export async function loadChampionBuild(query: string, signal: AbortSignal) {
  const session = await reconnectCompanion(signal);
  if (!session) throw Error('Open or reconnect DraftEdge Companion from the draft, then retry.');
  if (session.championBuildsVersion !== 2) throw Error('Update DraftEdge Companion to load builds.');
  const init = {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    targetAddressSpace: 'loopback',
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    headers: { 'X-DraftLab-Session': session.token },
  } satisfies RequestInit & { targetAddressSpace: string };
  const params = new URLSearchParams(query);
  if (!session.draftBuilds) params.delete('draft');
  const response = await fetch(`http://127.0.0.1:${session.port}/api/build?${params}`, init);
  if (!response.ok) throw Error('LoLalytics build data is temporarily unavailable.');
  const { build } = await response.json() as { build: ChampionBuild | null };
  return build;
}

export type BuildAsset = { name: string; src?: string };
type DragonImage = { name: string; image: { full: string } };
type DragonSummoner = DragonImage & { key: string };
type DragonRune = { id: number; name: string; icon: string };
type DragonTree = DragonRune & { slots: { runes: DragonRune[] }[] };
export type BuildAssets = {
  spells: BuildAsset[];
  passive?: BuildAsset;
  summoners: Record<string, BuildAsset>;
  items: Record<string, BuildAsset>;
  runes: Record<number, BuildAsset>;
  trees: (BuildAsset & { slots: number[][] })[];
};

const dragon = 'https://ddragon.leagueoflegends.com';
const runeTreeOrder: Record<number, number> = { 8000: 1, 8100: 2, 8200: 3, 8400: 4, 8300: 5 };

export const shardIcon = (icon: string) => `${dragon}/cdn/img/perk-images/StatMods/StatMods${icon}Icon.png`;

export async function loadBuildAssets(key: string, signal: AbortSignal): Promise<BuildAssets> {
  async function get<T>(path: string): Promise<T> {
    const response = await fetch(dragon + path, { signal, credentials: 'omit' });
    if (!response.ok) throw Error('Data Dragon unavailable.');
    return response.json() as Promise<T>;
  }
  const [version] = await get<string[]>('/api/versions.json');
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw Error('Invalid Data Dragon version.');
  const cdn = `/cdn/${version}`;
  const data = `${cdn}/data/en_US`;
  const [champions, items, trees, summoners] = await Promise.all([
    get<{ data: Record<string, { spells: DragonImage[]; passive?: DragonImage }> }>(`${data}/champion/${key}.json`).catch(() => null),
    get<{ data: Record<string, DragonImage> }>(`${data}/item.json`).catch(() => null),
    get<DragonTree[]>(`${data}/runesReforged.json`).catch(() => null),
    get<{ data: Record<string, DragonSummoner> }>(`${data}/summoner.json`).catch(() => null),
  ]);
  const withIcon = ({ name, image }: DragonImage, folder: string) => ({
    name, src: `${dragon}${cdn}/img/${folder}/${image.full}`,
  });
  const runeAsset = ({ name, icon }: DragonRune) => ({
    name, src: `${dragon}/cdn/img/${icon}`,
  });
  const champion = champions?.data[key];
  return {
    spells: champion?.spells.map((spell) => withIcon(spell, 'spell')) ?? [],
    passive: champion?.passive && withIcon(champion.passive, 'passive'),
    summoners: Object.fromEntries(Object.values(summoners?.data ?? {}).map(
      (spell) => [spell.key, withIcon(spell, 'spell')],
    )),
    items: Object.fromEntries(Object.entries(items?.data ?? {}).map(
      ([id, item]) => [id, withIcon(item, 'item')],
    )),
    runes: Object.fromEntries((trees ?? []).flatMap((tree) =>
      tree.slots.flatMap((slot) => slot.runes.map((rune) => [
        rune.id, runeAsset(rune),
      ])),
    )),
    trees: [...(trees ?? [])]
      .sort((a, b) => (runeTreeOrder[a.id] ?? 6) - (runeTreeOrder[b.id] ?? 6))
      .map((tree) => ({
        ...runeAsset(tree),
        slots: tree.slots.map((slot) => slot.runes.map(({ id }) => id)),
      })),
  };
}
