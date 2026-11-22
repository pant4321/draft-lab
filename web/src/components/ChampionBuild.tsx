import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ROLE_NAMES } from '../domain/draft-math';
import type { Champion, Role } from '../domain/types';
import {
  ITEM_SECTIONS,
  NO_BOOTS,
  championBuildQuery,
  loadBuildAssets,
  loadChampionBuild,
  shardIcon,
} from '../services/champion-builds';
import type {
  BuildAsset, BuildAssets, BuildDecision, BuildOpponent, BuildOption, ChampionBuild as Build, DraftChange, RunePage, RuneStats, Stats,
} from '../services/champion-builds';
import { Dialog, Portrait } from './shared';

const shards: Record<number, [name: string, icon: string]> = {
  5001: ['Health scaling', 'HealthScaling'],
  5002: ['Armor', 'Armor'],
  5003: ['Magic resist', 'MagicRes'],
  5005: ['Attack speed', 'AttackSpeed'],
  5007: ['Ability haste', 'CDRScaling'],
  5008: ['Adaptive force', 'AdaptiveForce'],
  5010: ['Move speed', 'MovementSpeed'],
  5011: ['Health', 'HealthPlus'],
  5013: ['Tenacity and slow resist', 'Tenacity'],
};
const shardSlots = [
  [5008, 5005, 5007],
  [5008, 5010, 5001],
  [5011, 5013, 5001],
];
const abilities = ['Q', 'W', 'E', 'R'];
const MIN_DRAFT_OPTION_WIN_RATE_GAMES = 100;

function WinRate({ winRate, games, compact = false, countOnly = false }: Stats & {
  compact?: boolean;
  countOnly?: boolean;
}) {
  return (
    <span className="build-stats">
      {!countOnly && <strong>{winRate.toFixed(compact ? 2 : 1)}% {compact ? <abbr title="Win rate">WR</abbr> : 'win'}</strong>}
      <span>{games.toLocaleString()} {compact ? 'matches' : 'games'}</span>
    </span>
  );
}

function Icon({ asset }: { asset: BuildAsset }) {
  const [failed, setFailed] = useState<string>();
  return asset.src && failed !== asset.src
    ? <img className="build-icon" src={asset.src} alt="" onError={() => setFailed(asset.src)} />
    : <span className="build-icon build-icon-fallback" aria-hidden="true">{asset.name[0]}</span>;
}

function LabeledIcon({ asset, count = 1, detail }: { asset: BuildAsset; count?: number; detail?: Stats }) {
  const label = (count > 1 ? count + ' × ' : '') + asset.name;
  const title = detail ? `${label} · ${detail.winRate.toFixed(2)}% win · ${detail.games.toLocaleString()} matches` : label;
  return (
    <span className="build-labeled-icon" role="img" aria-label={title} title={title}>
      <Icon asset={asset} />
      {count > 1 && <strong aria-hidden="true">{count}</strong>}
    </span>
  );
}

type OpponentNames = ReadonlyMap<number, string>;

function lowSampleOption(change?: DraftChange) {
  return Boolean(change?.opponents.length
    && change.opponents.every(({ games }) => games < MIN_DRAFT_OPTION_WIN_RATE_GAMES));
}

function windowLabel(window: string) {
  return window === '14' || window === '30' ? `Last ${window} days` : `Patch ${window}`;
}

function DraftReason({ change, opponents, optionName, situational = false }: {
  change: DraftChange | undefined;
  opponents: OpponentNames;
  optionName: (key: string) => string;
  situational?: boolean;
}) {
  if (!change) return null;
  const drivers = change.opponents;
  const lead = drivers[0] && opponents.get(drivers[0].opponentId);
  const otherCount = drivers.length - 1;
  const label = situational ? 'Draft option' : 'Draft pick';
  const lowSample = situational && lowSampleOption(change);
  return (
    <details className="build-draft-reason">
      <summary>
        {lead ? `${label} vs. ${lead}${otherCount > 0 ? ' +' + otherCount : ''}` : label}
        {lowSample && <span className="build-low-sample"> · Low sample</span>}
      </summary>
      {change.usual && <p>Usual pick: {optionName(change.usual.key)} <WinRate {...change.usual} compact /></p>}
      <p>
        {(change.generalPickShare * 100).toFixed(1)}% picked in all matchups
        {change.window && ` · ${windowLabel(change.window)}`}
      </p>
      <ul>
        {drivers.map((row) => {
          const countOnly = situational && row.games < MIN_DRAFT_OPTION_WIN_RATE_GAMES;
          return (
            <li key={row.opponentId}>
              <span>{opponents.get(row.opponentId)} · {(row.pickShare * 100).toFixed(1)}% picked</span>
              <WinRate {...row} compact countOnly={countOnly} />
              {countOnly && !lowSample && <span>Low sample</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function SpellPair({ pair, assets, countOnly }: { pair: BuildOption; assets: BuildAssets | null; countOnly?: boolean }) {
  return (
    <div className="build-spell-pair">
      <ul>
        {pair.key.split('_').map((id, index) => (
          <li key={index}><LabeledIcon asset={assets?.summoners[id] ?? { name: 'Spell ' + id }} /></li>
        ))}
      </ul>
      <WinRate {...pair} compact countOnly={countOnly} />
    </div>
  );
}

function SummonerSpells({ build, assets, opponents }: { build: Build; assets: BuildAssets | null; opponents: OpponentNames }) {
  const [expanded, setExpanded] = useState(false);
  const { summoners, summonerAlternatives = [] } = build;
  const draftAlternatives = build.draft?.alternatives?.summoners;
  const spellName = (key: string) => key.split('_').map((id) => assets?.summoners[id]?.name ?? 'Spell ' + id).join(' + ');
  return (
    <section className="build-panel build-summoners" aria-labelledby="build-summoners-title">
      <div className="build-summoner-head">
        <h3 id="build-summoners-title">Summoner spells</h3>
        {summoners ? <SpellPair pair={summoners} assets={assets} /> : <span className="build-empty">Spell data is unavailable.</span>}
        {summonerAlternatives.length > 0 && (
          <button
            type="button"
            className="ghost build-summoner-toggle"
            aria-expanded={expanded}
            aria-controls="build-summoner-alternatives"
            aria-label={expanded ? 'Hide summoner spell alternatives' : 'Show summoner spell alternatives'}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide alternatives' : draftAlternatives ? 'Alternatives · Draft option' : 'Alternatives'}
          </button>
        )}
      </div>
      <DraftReason change={build.draft?.changes.summoners} opponents={opponents} optionName={spellName} />
      <div id="build-summoner-alternatives" className="build-summoner-alternatives" hidden={!expanded}>
        {summonerAlternatives.map((pair) => (
          <div key={pair.key}>
            <SpellPair pair={pair} assets={assets} countOnly={lowSampleOption(draftAlternatives?.[pair.key])} />
            <DraftReason change={draftAlternatives?.[pair.key]} opponents={opponents} optionName={spellName} situational />
          </div>
        ))}
      </div>
    </section>
  );
}

function AbilityOrder({ build, assets }: { build: Build; assets: BuildAssets | null }) {
  const spells = Object.fromEntries(abilities.map((key, index) => [
    key, assets?.spells[index] ?? { name: key },
  ]));
  const levels = Array.from(build.levelOrder?.key ?? '');
  const rows = levels.includes('-') ? [...abilities, '-'] : abilities;
  return (
    <section className="build-panel build-abilities" aria-labelledby="build-abilities-title">
      <div className="build-section-head">
        <h3 id="build-abilities-title">Ability order</h3>
        {build.maxOrder && (
          <div className="build-priority">
            <span>Max first</span>
            <ol aria-label="Ability priority">
              {Array.from(build.maxOrder.key, (key, index) => (
                <li key={index} title={spells[key].name}>
                  <Icon asset={spells[key]} />
                  <strong>{key}</strong>
                </li>
              ))}
            </ol>
          </div>
        )}
        {build.levelOrder && <WinRate {...build.levelOrder} />}
      </div>
      {levels.length > 0 ? (
        <div className="build-skill-scroll" tabIndex={0} role="region" aria-label="Ability level grid">
          <table
            className="build-skill-table"
            aria-label="Ability by level"
            style={{ '--build-level-count': levels.length } as CSSProperties}
          >
            <colgroup>
              <col className="build-skill-label-column" />
              <col className="build-skill-level-column" span={levels.length} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Level</th>
                {levels.map((_, index) => <th scope="col" key={index}>{index + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((key) => (
                <tr key={key}>
                  <th scope="row" title={spells[key]?.name}>
                    {key === '-' ? 'Hold' : (
                      <>
                        <Icon asset={spells[key]} />
                        <strong>{key}</strong>
                        {spells[key].name !== key && <span className="build-spell-name">{spells[key].name}</span>}
                      </>
                    )}
                  </th>
                  {levels.map((choice, index) => (
                    <td key={index} className={choice === key ? 'build-skill-picked' : undefined}>
                      {choice === key && (
                        <>
                          {index + 1}
                          <span className="build-sr-only">{key === '-' ? 'Hold point' : key}</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {assets?.passive && (
                <tr className="build-passive">
                  <th scope="row" title={assets.passive.name}>
                    <Icon asset={assets.passive} />
                    <abbr title="Passive">P</abbr>
                    <span className="build-spell-name">{assets.passive.name}</span>
                  </th>
                  <td colSpan={levels.length} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="build-empty">Level-by-level data is unavailable.</p>
      )}
    </section>
  );
}

function runeAsset(assets: BuildAssets | null, id: number): BuildAsset {
  return assets?.runes[id] ?? { name: 'Rune ' + id };
}

function RuneSlot({ choices, chosen, asset, keystone = false }: {
  choices: number[];
  chosen: number[];
  asset: (id: number) => BuildAsset;
  keystone?: boolean;
}) {
  return (
    <ul className="build-rune-slot" data-keystone={keystone || undefined}>
      {choices.map((id) => {
        const option = asset(id);
        const picked = chosen.includes(id);
        return (
          <li key={id} data-picked={picked || undefined} title={option.name}>
            <span role="img" aria-label={option.name + (picked ? ' (selected)' : '')}>
              <Icon asset={option} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RunePicks({ position, chosen, assets, children }: {
  position: 'primary' | 'secondary';
  chosen: number[];
  assets: BuildAssets | null;
  children?: ReactNode;
}) {
  const primary = position === 'primary';
  const label = primary ? 'Primary' : 'Secondary';
  const tree = assets?.trees.find((candidate) =>
    chosen.every((id) => candidate.slots.some((slot) => slot.includes(id))),
  );
  const slots = tree ? tree.slots.slice(primary ? 0 : 1) : chosen.map((id) => [id]);

  return (
    <div className="build-rune-summary-group">
      <h4>{tree && <Icon asset={tree} />}{tree?.name ?? label}{tree && <small>{label}</small>}</h4>
      <div className="build-rune-slots">
        {slots.map((slot, index) => (
          <RuneSlot
            key={index}
            choices={slot}
            chosen={chosen}
            asset={(id) => runeAsset(assets, id)}
            keystone={primary && index === 0}
          />
        ))}
      </div>
      {children}
    </div>
  );
}

function shardAsset(id: number): BuildAsset {
  const [name, icon] = shards[id] ?? ['Shard ' + id, ''];
  return { name, src: icon ? shardIcon(icon) : undefined };
}

function ShardPicks({ chosen }: { chosen: number[] }) {
  return (
    <div className="build-shard-picks" role="group" aria-label="Stat shards">
      {chosen.map((id, index) => {
        const slot = shardSlots[index] ?? [];
        const choices = slot.includes(id) ? slot : [...slot, id];
        return <RuneSlot key={index} choices={choices} chosen={[id]} asset={shardAsset} />;
      })}
    </div>
  );
}

function RuneTrees({ position, assets, stats }: {
  position: 'primary' | 'secondary';
  assets: BuildAssets;
  stats?: RuneStats;
}) {
  const primary = position === 'primary';
  return (
    <section className="build-rune-comparison">
      <h4>{primary ? 'Primary trees' : 'Secondary trees'}</h4>
      <div className="build-rune-tree-grid">
        {assets.trees.map((tree) => (
          <section className="build-rune-tree" key={tree.name}>
            <h5><Icon asset={tree} />{tree.name}</h5>
            {tree.slots.slice(primary ? 0 : 1).map((slot, index) => (
              <ul className={'build-rune-row' + (primary && index === 0 ? ' build-keystones' : '')} key={index}>
                {slot.map((id) => {
                  const rune = runeAsset(assets, id);
                  const detail = stats?.[id];
                  const popular = (detail?.pickRate ?? 0) > 1;
                  return (
                    <li
                      key={id}
                      data-popular={popular || undefined}
                      title={detail ? rune.name + ' · ' + detail.games.toLocaleString() + ' games' : rune.name}
                    >
                      <span role="img" aria-label={rune.name}>
                        <Icon asset={rune} />
                      </span>
                      {detail ? (
                        <>
                          <strong>{detail.winRate.toFixed(1)}%<span className="build-sr-only"> win rate</span></strong>
                          <span className="build-rune-pick-rate">{detail.pickRate.toFixed(1)}%<span className="build-sr-only"> pick rate</span></span>
                        </>
                      ) : <span className="build-rune-no-data" aria-label="No sample">—</span>}
                    </li>
                  );
                })}
              </ul>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function Runes({ build, assets, opponents }: { build: Build; assets: BuildAssets | null; opponents: OpponentNames }) {
  const [expanded, setExpanded] = useState(false);
  const { runes: pages, runeStats: stats } = build;
  const page = pages.find((option) => option.kind === 'pick') ?? pages[0];
  const runeName = (key: string) => runeAsset(assets, Number(key)).name;
  const alternatives = Object.values(build.draft?.alternatives?.keystone ?? {});
  const toggleLabel = expanded ? 'Hide full' : 'Show full';
  return (
    <>
      <section className="build-panel build-rune-panel" aria-labelledby="build-runes-title">
        <div className="build-section-head">
          <h3 id="build-runes-title">Runes</h3>
          {page && <span className="build-keystone-stats">{page.statsFor === 'page' ? 'Rune page' : 'Keystone'} <WinRate {...page} /></span>}
          {assets && assets.trees.length > 0 && (
            <button
              type="button"
              className="ghost build-rune-toggle"
              aria-label={toggleLabel + ' rune trees'}
              aria-expanded={expanded}
              aria-controls="build-full-runes"
              onClick={() => setExpanded((previous) => !previous)}
            >
              {toggleLabel}<span> rune trees</span>
            </button>
          )}
        </div>
        {page ? (
          <div className="build-rune-summary">
            <RunePicks position="primary" chosen={page.primary} assets={assets} />
            <RunePicks position="secondary" chosen={page.secondary} assets={assets}>
              <ShardPicks chosen={page.shards} />
            </RunePicks>
          </div>
        ) : <p className="build-empty">Rune data is unavailable.</p>}
        <DraftReason change={build.draft?.changes.keystone} opponents={opponents} optionName={runeName} />
        {alternatives.length > 0 && (
          <details className="build-rune-alternatives">
            <summary>Alternatives · Draft option</summary>
            {alternatives.map((change) => change.option && (
              <div key={change.option.key}>
                <LabeledIcon asset={runeAsset(assets, Number(change.option.key))} />
                <WinRate {...change.option} compact countOnly={lowSampleOption(change)} />
                <DraftReason change={change} opponents={opponents} optionName={runeName} situational />
              </div>
            ))}
          </details>
        )}
      </section>
      <section id="build-full-runes" hidden={!expanded} className="build-panel build-rune-full" aria-label="Full rune trees">
        {expanded && assets && (
          <>
            {stats && <p className="build-rune-legend">Win rate above, pick rate below. Runes with over 1% pick rate are highlighted.</p>}
            <RuneTrees position="primary" assets={assets} stats={stats?.primary} />
            <RuneTrees position="secondary" assets={assets} stats={stats?.secondary} />
          </>
        )}
      </section>
    </>
  );
}

function itemAsset(assets: BuildAssets | null, id: string) {
  return id === NO_BOOTS ? { name: 'No boots' } : assets?.items[id] ?? { name: 'Item ' + id };
}

function ItemRow({ option, assets, ordered = false, countOnly }: {
  option: BuildOption;
  assets: BuildAssets | null;
  ordered?: boolean;
  countOnly?: boolean;
}) {
  const counts = new Map<string, number>();
  for (const id of option.key.split('_')) counts.set(id, (counts.get(id) ?? 0) + 1);
  const List = ordered ? 'ol' : 'ul';
  if (option.key === NO_BOOTS) {
    return (
      <div className="build-item-row">
        <strong className="build-no-boots">No boots</strong>
        <span className="build-stats">
          {option.pickRate !== undefined && <span>{option.pickRate.toFixed(1)}% of games</span>}
          <span>{option.games.toLocaleString()} matches</span>
        </span>
      </div>
    );
  }
  return (
    <div className="build-item-row" data-ordered={ordered || undefined}>
      <List>
        {Array.from(counts, ([id, count]) => (
          <li key={id}><LabeledIcon asset={itemAsset(assets, id)} count={count} /></li>
        ))}
      </List>
      <WinRate {...option} compact countOnly={countOnly} />
    </div>
  );
}

function ItemGroup({
  label, options, assets, opponents, change, core = false, coreSteps = [],
  draftAlternatives, legacyOption = false,
}: {
  label: string;
  options: BuildOption[];
  assets: BuildAssets | null;
  opponents: OpponentNames;
  change?: DraftChange;
  core?: boolean;
  coreSteps?: BuildOption[];
  draftAlternatives?: Record<string, DraftChange>;
  legacyOption?: boolean;
}) {
  const [first, ...alternatives] = options;
  const itemName = (key: string) => [...new Set(key.split('_'))].map((id) => itemAsset(assets, id).name).join(' + ');
  return (
    <section className="build-item-group" aria-label={label} data-core={core || undefined}>
      <h4>{label}</h4>
      {coreSteps.length > 0 ? (
        <div className="build-item-row build-core-steps" data-ordered>
          <ol>
            {coreSteps.map((step) => (
              <li key={step.key}>
                <LabeledIcon asset={itemAsset(assets, step.key)} detail={step} />
                <span className="build-stats" aria-hidden="true">
                  <strong>{step.winRate.toFixed(1)}%</strong>
                  <span>{step.games.toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ol>
          <span className="build-item-note">Win rate and matches per item</span>
        </div>
      ) : first && (
        <>
          <ItemRow option={first} assets={assets} ordered={core}
            countOnly={legacyOption && lowSampleOption(change)} />
          <DraftReason change={change} opponents={opponents} optionName={itemName} situational={legacyOption} />
          {alternatives.length > 0 && (
            <ul className="build-item-alternatives" aria-label={`Alternatives for ${label.toLowerCase()}`}>
              {alternatives.map((option) => (
                <li key={option.key}>
                  <ItemRow option={option} assets={assets} ordered={core}
                    countOnly={lowSampleOption(draftAlternatives?.[option.key])} />
                  <DraftReason change={draftAlternatives?.[option.key]} opponents={opponents} optionName={itemName} situational />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const legendaryLabels: Partial<Record<keyof Build['items'], string>> = {
  item1: 'First legendary', item2: 'Second legendary', item4: 'Third legendary',
  item5: 'Fourth legendary', item6: 'Fifth legendary',
};

function Items({ build: { items, coreSteps, draft, legendarySlots }, assets, opponents }: {
  build: Build;
  assets: BuildAssets | null;
  opponents: OpponentNames;
}) {
  const groups = ITEM_SECTIONS.filter(([key]) => key === 'builtBootSet3'
    ? !items.item1.length && !items.item2.length && (items[key].length || coreSteps.length)
    : items[key].length);
  return (
    <section className="build-panel build-items">
      <h3>Items</h3>
      {groups.length > 0 ? (
        <div className="build-item-columns">
          {groups.map(([key, label]) => (
            <ItemGroup
              key={key}
              label={(legendarySlots && legendaryLabels[key]) || label}
              options={items[key]}
              assets={assets}
              opponents={opponents}
              change={draft?.changes[key]}
              draftAlternatives={draft?.alternatives?.[key]}
              core={key === 'builtBootSet3'}
              coreSteps={key === 'builtBootSet3' ? coreSteps : undefined}
              legacyOption={Boolean(draft && !draft.alternatives && legendaryLabels[key])}
            />
          ))}
        </div>
      ) : <p className="build-empty">Item data is unavailable.</p>}
    </section>
  );
}

const decisionLabels: Record<BuildDecision, string> = {
  startSet: 'Starting items', summoners: 'Summoner spells', keystone: 'Runes', boots: 'Boots',
  builtBootSet3: 'Core build', item1: 'First legendary', item2: 'Second legendary',
  item4: 'Third legendary', item5: 'Fourth legendary', item6: 'Fifth legendary',
};

function BuildSources({ build }: { build: Build }) {
  const window = build.window ?? '30';
  const byWindow = new Map<string, string[]>();
  for (const [key, value] of Object.entries(build.windows ?? {})) {
    if (value !== window) {
      const labels = byWindow.get(value) ?? [];
      labels.push(decisionLabels[key as BuildDecision]);
      byWindow.set(value, labels);
    }
  }
  return (
    <span className="build-stat-source">
      {windowLabel(window)}
      {Array.from(byWindow, ([other, labels]) => (
        <span key={other}> · {labels.join(', ')} {labels.length === 1 ? 'uses' : 'use'} {windowLabel(other).toLowerCase()}</span>
      ))}
      {build.draft && ' · Expand a draft badge for opponent stats'}
    </span>
  );
}

type BuildContent = { status: 'loading' } | { status: 'ready'; build: Build } | { status: 'error'; message: string };

function BuildResults({ query, opponent, assets, draft }: {
  query: string;
  opponent: BuildOpponent | null;
  assets: BuildAssets | null;
  draft: BuildOpponent[];
}) {
  const [content, setContent] = useState<BuildContent>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const opponents = new Map(draft.map((enemy) => [enemy.id, enemy.name]));

  useEffect(() => {
    const controller = new AbortController();
    void loadChampionBuild(query, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setContent(value
        ? { status: 'ready', build: value }
        : { status: 'error', message: 'No build data is available for this champion and role.' });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setContent({ status: 'error', message: error instanceof Error ? error.message : 'Could not load build data.' });
    });
    return () => controller.abort();
  }, [query, attempt]);

  return (
    <>
      {content.status === 'loading' && <p className="status" role="status">Loading build…</p>}
      {content.status === 'error' && (
        <div className="build-error">
          <p className="status" role="status">{content.message}</p>
          <button className="ghost" onClick={() => {
            setContent({ status: 'loading' });
            setAttempt((previous) => previous + 1);
          }}>Retry</button>
        </div>
      )}
      {content.status === 'ready' && (
        <>
          {opponent && content.build.opponentId === null && (
            <p className="build-matchup-note" role="status">
              Showing all matchups. No build data against {opponent.name} for this rank and role.
            </p>
          )}
          {draft.length > 0 && !content.build.draft && (
            <p className="build-matchup-note" role="status">Update DraftEdge Companion for draft recommendations. Showing all matchups.</p>
          )}
          {content.build.draft && content.build.draft.opponentIds.length < draft.length && (
            <p className="build-matchup-note" role="status">
              Matchup data available for {content.build.draft.opponentIds.length} of {draft.length} revealed opponents.
            </p>
          )}
          <div className="build-details">
            <div className="build-ability-spells">
              <AbilityOrder build={content.build} assets={assets} />
              <SummonerSpells build={content.build} assets={assets} opponents={opponents} />
            </div>
            <Runes build={content.build} assets={assets} opponents={opponents} />
            <Items build={content.build} assets={assets} opponents={opponents} />
            <footer className="build-footer">
              <BuildSources build={content.build} />
              <WinRate {...content.build} />
            </footer>
          </div>
        </>
      )}
    </>
  );
}

function BuildBody({ championKey, query, opponent, draft }: {
  championKey: string;
  query: string;
  opponent: BuildOpponent | null;
  draft: BuildOpponent[];
}) {
  const [assets, setAssets] = useState<BuildAssets | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadBuildAssets(championKey, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]))
      .then((value) => { if (!controller.signal.aborted) setAssets(value); })
      .catch(() => {});
    return () => controller.abort();
  }, [championKey]);

  return (
    <div className="build-body">
      <BuildResults key={query} query={query} opponent={opponent} assets={assets} draft={draft} />
    </div>
  );
}

export function ChampionBuild({ champion, role, rank, opponents, open, close }: {
  champion: Champion;
  role: Role;
  rank?: string;
  opponents: BuildOpponent[];
  open: boolean;
  close: () => void;
}) {
  const [choice, setChoice] = useState('auto');
  const chosenOpponent = opponents.find((matchup) => String(matchup.id) === choice);
  const opponent = chosenOpponent ?? null;
  const draft = choice === 'all' || opponent ? [] : opponents;
  const tier = rank === 'Emerald+' ? 'emerald_plus' : 'all';
  const query = championBuildQuery({
    id: champion.id,
    key: champion.key,
    role,
    tier,
    opponent,
    draft,
  });
  return (
    <Dialog open={open} close={close} focus=".build-close" className="champion-build" aria-labelledby="champion-build-title">
      <div className="build-header">
        <Portrait champion={champion} className="build-portrait" />
        <div>
          <h2 id="champion-build-title">{champion.name} build</h2>
          <p>{ROLE_NAMES[role]} · {tier === 'all' ? 'All ranks' : 'Emerald+'}</p>
        </div>
        {opponents.length > 0 && (
          <select
            className="build-matchup"
            aria-label="Build matchup"
            value={chosenOpponent || choice === 'all' ? choice : 'auto'}
            onChange={(event) => setChoice(event.currentTarget.value)}
          >
            <option value="auto">Recommended for this draft</option>
            {opponents.map((matchup) => (
              <option key={matchup.id} value={matchup.id}>vs. {matchup.name} · {ROLE_NAMES[matchup.role]}</option>
            ))}
            <option value="all">All matchups</option>
          </select>
        )}
        <button type="button" className="ghost build-close" aria-label="Close build" onClick={close}>Close <span aria-hidden="true">×</span></button>
      </div>
      {open && <BuildBody championKey={champion.key} query={query} opponent={opponent} draft={draft} />}
    </Dialog>
  );
}
