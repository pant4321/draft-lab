import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { poolSections } from '../domain/champion-pool';
import { sortRecommendationRows } from '../domain/draft-list';
import { ROLE_NAMES } from '../domain/draft-math';
import { customMultipliers } from '../domain/draft-weights';
import { draftSamplingOffsets } from '../domain/sampling';
import type { Candidate, Recommendation } from '../domain/draft-list';
import type { DraftLab } from '../useDraftLab';
import type { useSpread } from './Spread';
import { MetricHelp } from './StaticContent';
import { norm, Portrait, signed, tone } from './shared';

const headings = [
  { key: 'counter', label: 'Counters' },
  { key: 'synergy', label: 'Synergy' },
  {
    key: 'blindability',
    label: 'Blindability',
    help: 'How safe a champion is to pick before you know the enemy team. Higher means less risk from common counters.',
  },
  {
    key: 'sample',
    label: 'Sample Δ',
    help: 'How much Draft Edge could shift because the matchup stats are based on a limited number of games.',
  },
  {
    key: 'score',
    label: 'Draft Edge',
    help: 'How well a champion fits the picks on the board, based on synergy with allies and matchups against enemies.',
  },
] as const;
type SortKey = (typeof headings)[number]['key'];
type Sort = { mode: Recommendation['mode']; key: SortKey; direction: 1 | -1 };
type RankingRow = Candidate & {
  blindability: number | null | undefined;
  sample: number | null;
  sampleRange: ReturnType<typeof draftSamplingOffsets>;
};

function CandidateRow({
  lab,
  row,
  pool,
  title,
  index,
  spread,
}: {
  lab: DraftLab;
  row: RankingRow;
  pool: string;
  title: string | null;
  index: number;
  spread: ReturnType<typeof useSpread>;
}) {
  const champion = lab.state.roster.get(row.id);
  const name = champion?.name ?? String(row.id);
  const range = row.sampleRange;
  const score = row.score === null ? '—' : signed(row.score);
  const up =
    range && row.score !== null
      ? (Number((row.score + range.up).toFixed(2)) - Number(score)).toFixed(2)
      : null;
  const down =
    range && row.score !== null
      ? (Number(score) - Number((row.score - range.down).toFixed(2))).toFixed(2)
      : null;
  const smallSample = 'smallSample' in row && row.smallSample;
  const evidence = [
    range ? `Sampling offsets +${up} and −${down} Draft Edge points.` : '',
    smallSample ? 'At least one matchup has fewer than 500 games.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={'pick' + (row.id === lab.selected ? ' selected' : '')}
      data-pool-group={pool}
    >
      <button
        className="pick-inspect"
        data-candidate={row.id}
        title={evidence || undefined}
        aria-label={`Inspect ${name}, rank ${index}${title ? ' in ' + title.toLowerCase() : ''}${row.score === null ? '' : ', draft edge ' + score}${evidence ? '. ' + evidence : ''}`}
        onClick={() => {
          spread.hide();
          lab.dispatch({ type: 'select', id: row.id });
        }}
      />
      <span className="pick-lead">
        <span className="pick-rank">{index}</span>
        <span className="pick-portrait">
          <Portrait champion={champion} />
          {smallSample && (
            <span className="pick-low-sample" aria-hidden="true">
              ⚠︎
            </span>
          )}
        </span>
        <span className="pick-name">
          {name}
          <small>{(100 * row.wr).toFixed(1)}% WR</small>
        </span>
      </span>
      <span
        className={
          'pick-pair ' + (row.counter === null ? 'zero' : tone(row.counter))
        }
      >
        {row.counter === null ? '—' : signed(row.counter)}
      </span>
      <span
        className={
          'pick-pair ' + (row.synergy === null ? 'zero' : tone(row.synergy))
        }
      >
        {row.synergy === null ? '—' : signed(row.synergy)}
      </span>
      {spread.cell(row.id)}
      <span
        className={'pick-pair pick-sampling-range' + (range ? '' : ' zero')}
        aria-hidden="true"
      >
        {row.sample === null ? '—' : '±' + row.sample.toFixed(2)}
      </span>
      <span
        className={
          'pick-total ' + (row.score === null ? 'zero' : tone(row.score))
        }
      >
        {score}
      </span>
    </div>
  );
}

export function Recommendations({
  lab,
  search,
  setSearch,
  openPool,
  spread,
}: {
  lab: DraftLab;
  search: string;
  setSearch: (value: string) => void;
  openPool: () => void;
  spread: ReturnType<typeof useSpread>;
}) {
  const {
    state: { draft, includeStrength, weights, pools, roster },
    ranking,
    roleProfiles,
    blind,
    pending,
    datasetError,
    profileError,
    dispatch,
  } = lab;
  const [sort, setSort] = useState<Sort | null>(null);
  const results = useRef<HTMLDivElement>(null);
  const mode = ranking?.mode;
  const blindMode = mode === 'blindability';
  const rows = useMemo<RankingRow[]>(
    () =>
      ranking?.ranked.map((row) => {
        const sampleRange =
          row.score === null
            ? null
            : draftSamplingOffsets(row, roleProfiles?.[row.id]);
        return {
          ...row,
          blindability: blind[row.id]?.score,
          sampleRange,
          sample: sampleRange ? (sampleRange.up + sampleRange.down) / 2 : null,
        };
      }) ?? [],
    [ranking, blind, roleProfiles],
  );
  const hasValues = (key: SortKey) =>
    !pending && rows.some((row) => Number.isFinite(row[key]));
  const sortValid = sort && sort.mode === mode && hasValues(sort.key);
  const key = sortValid ? sort.key : blindMode ? 'blindability' : 'score';
  const direction = sortValid ? sort.direction : -1;
  useEffect(() => {
    if (!pending && mode && !sortValid && sort !== null) setSort(null);
  }, [pending, mode, sortValid, sort]);

  const order = headings.find((heading) => heading.key === key)?.label;
  const allied = Object.values(draft.allies).filter((id) => id !== null).length;
  const enemy = Object.values(draft.enemies).filter((id) => id !== null).length;
  const context = blindMode
    ? ''
    : `${ROLE_NAMES[draft.role]} · ${allied} ${allied === 1 ? 'ally' : 'allies'} · ${enemy} ${enemy === 1 ? 'enemy' : 'enemies'} · `;
  const query = norm(search);
  const pool = pools[draft.role];
  const sections = poolSections(rows, pool).map((section) => ({
    ...section,
    rows: sortRecommendationRows(section.rows, key, direction)
      .map((row, index) => ({ row, rank: index + 1 }))
      .filter(({ row }) =>
        norm(roster.get(row.id)?.name ?? '').includes(query),
      ),
  }));
  const hasRows = sections.some((section) => section.rows.length);
  const ready = ranking && !pending && !profileError;
  const unavailable = profileError || (!ranking && datasetError);
  return (
    <section className="recommendations" aria-labelledby="ranking-title">
      <h1 id="ranking-title" className="sr-only">
        {ready
          ? blindMode
            ? `Blind picks for ${ROLE_NAMES[draft.role]}`
            : 'Best picks for this draft'
          : 'Draft recommendations'}
      </h1>
      <p id="ranking-context" className="sr-only">
        {pending
          ? 'Loading dataset…'
          : ranking
            ? `${context}Sorted by ${order}, ${direction === 1 ? 'lowest' : 'highest'} first${!blindMode && customMultipliers(weights) ? ' · Custom weights' : ''}`
            : 'Loading ' + ROLE_NAMES[draft.role].toLowerCase() + ' pairs…'}
      </p>
      <div className="results-tools">
        <input
          id="candidate-search"
          type="search"
          placeholder="Find a champion?"
          aria-label="Filter recommendations"
          value={search}
          onChange={(event) => {
            spread.hide();
            setSearch(event.currentTarget.value);
          }}
        />
        <div className="results-actions">
          <label className="strength">
            <input
              id="include-strength"
              type="checkbox"
              disabled={blindMode}
              checked={includeStrength}
              onChange={(event) => {
                spread.hide();
                dispatch({
                  type: 'includeStrength',
                  enabled: event.currentTarget.checked,
                });
              }}
            />
            Include base WR
          </label>
          <button
            id="edit-pool"
            className="ghost pool-button"
            aria-label="Edit your champion pool"
            disabled={pending || !roleProfiles}
            onClick={openPool}
          >
            Your pool{pool.length ? ' · ' + pool.length : ''}
          </button>
        </div>
      </div>
      <div className="ranking-head">
        <span className="ranking-champion">
          Champion{' '}
          <button
            className="ranking-metric-help"
            type="button"
            popoverTarget="ranking-metrics-help"
            aria-label="What the draft metrics mean"
          >
            ?
          </button>
        </span>
        {headings.map((heading) => {
          const active = hasValues(heading.key) && key === heading.key;
          return (
            <button
              key={heading.key}
              className="sort-heading"
              type="button"
              data-sort={heading.key}
              aria-describedby={
                'help' in heading ? 'metric-' + heading.key : undefined
              }
              title={'help' in heading ? heading.help : undefined}
              aria-pressed={active}
              disabled={!ready || !hasValues(heading.key)}
              data-direction={
                active ? (direction === 1 ? 'ascending' : 'descending') : ''
              }
              onClick={() => {
                if (!mode) return;
                spread.hide();
                setSort({
                  mode,
                  key: heading.key,
                  direction:
                    key === heading.key
                      ? direction === 1
                        ? -1
                        : 1
                      : heading.key === 'sample'
                        ? 1
                        : -1,
                });
                if (results.current) results.current.scrollTop = 0;
              }}
            >
              {heading.label}
            </button>
          );
        })}
      </div>
      <MetricHelp />
      <div id="rankings" aria-live="polite" ref={results}>
        {!ready ? (
          <div className="empty">
            {unavailable ? (
              <>
                <h3>Data unavailable.</h3>
                <p>Try selecting your role again.</p>
              </>
            ) : (
              <h3>
                {pending
                  ? 'Loading dataset…'
                  : `Loading ${ROLE_NAMES[draft.role].toLowerCase()} matchups…`}
              </h3>
            )}
          </div>
        ) : (
          <>
            {sections.map((section) => (
              <Fragment key={section.key}>
                {!section.rows.length ? (
                  section.key === 'pool' &&
                  !query && (
                    <>
                      <h2 className="ranking-group">Your pool</h2>
                      <p className="pool-unavailable">
                        None available for this draft.
                      </p>
                    </>
                  )
                ) : (
                  <>
                    {section.title && (
                      <h2 className="ranking-group">
                        {section.title} <span>{section.rows.length}</span>
                      </h2>
                    )}
                    {section.rows.map(({ row, rank }) => (
                      <CandidateRow
                        key={row.id}
                        lab={lab}
                        row={row}
                        index={rank}
                        title={section.title}
                        pool={section.key}
                        spread={spread}
                      />
                    ))}
                  </>
                )}
              </Fragment>
            ))}
            {!hasRows && (
              <div className="empty">
                <h3>No matching recommendations.</h3>
                <p>Clear your search or change the draft.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
