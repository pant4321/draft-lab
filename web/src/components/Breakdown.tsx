import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { remainingCounters } from '../domain/blindability';
import { ROLE_NAMES, ROLES } from '../domain/draft-math';
import type { ScoredCandidate } from '../domain/draft-math';
import { contributionSamplingRange } from '../domain/sampling';
import type { PairKind, Profile, Roster, ScoredPair } from '../domain/types';
import type { DraftLab } from '../useDraftLab';
import type { useSpread } from './Spread';
import { CounterMethod } from './StaticContent';
import { Portrait, signed, tone } from './shared';

function PairCard({ pair, roster }: { pair: ScoredPair; roster: Roster }) {
  const champion = roster.get(pair.id);
  const name = champion?.name ?? String(pair.id);
  const raw = pair.raw;
  const weighted = pair.weighted;
  const hasData = raw !== null && Number.isFinite(raw) && pair.games > 0;
  const ignored = pair.multiplier === 0;
  const available = hasData && weighted !== null && Number.isFinite(weighted);
  const fullCount = pair.games.toLocaleString('en-US') + ' games';
  const count =
    pair.games >= 1000 ? (pair.games / 1000).toFixed(1) + 'k games' : fullCount;
  return (
    <article className={'pair-card ' + pair.kind}>
      <div className="pair-title">
        <Portrait champion={champion} className="" />
        <span>
          <small>{ROLE_NAMES[pair.role]}</small>
          <span className="pair-champion" title={name}>
            {name}
          </span>
        </span>
      </div>
      <strong
        className={`pair-value ${!ignored && available ? tone(weighted) : 'zero'}${!available || ignored ? ' pair-unavailable' : ''}`}
      >
        {ignored ? 'Ignored' : available ? signed(weighted) : 'No data'}
      </strong>
      <p className="pair-metadata">
        {hasData ? (
          <>
            <span title={`Raw matchup delta: ${signed(raw)} percentage points`}>
              {signed(raw)} raw
            </span>
            <span aria-hidden="true">·</span>
            <span title={fullCount} aria-label={fullCount}>
              {count}
            </span>
          </>
        ) : (
          <span>No data</span>
        )}
      </p>
      {pair.multiplier !== 1 && (
        <p className="pair-weight">
          {pair.ignoredPick
            ? 'Excluded from calculations'
            : ignored
              ? '0× role weight'
              : pair.adjusted !== null
                ? `${signed(pair.adjusted)} adjusted × ${pair.multiplier}`
                : `${pair.multiplier}× role weight`}
        </p>
      )}
      {available && !ignored && pair.games < 500 && (
        <p className="pair-limited">Low sample</p>
      )}
    </article>
  );
}

function ContributionGroup({
  row,
  kind,
  roster,
}: {
  row: ScoredCandidate;
  kind: PairKind;
  roster: Roster;
}) {
  const allied = kind === 'ally';
  const title = allied ? 'With your team' : 'Against the enemy';
  const subtotal = allied ? row.synergy : row.counter;
  const pairs = row.pairs
    .filter((pair) => pair.kind === kind)
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  const missing = pairs.some(
    (pair) => pair.multiplier !== 0 && !Number.isFinite(pair.weighted),
  );
  return (
    <section className={'contribution-group ' + kind} aria-label={title}>
      <div className="contribution-heading">
        <h3>{title}</h3>
        <span>
          {allied ? 'Synergy' : 'Counters'}{' '}
          <b className={missing ? 'zero' : tone(subtotal)}>
            {missing ? 'No data' : signed(subtotal)}
          </b>
        </span>
      </div>
      <div
        className="pair-grid"
        style={{ '--pair-count': Math.max(1, pairs.length) } as CSSProperties}
      >
        {pairs.length ? (
          pairs.map((pair) => (
            <PairCard key={pair.role} pair={pair} roster={roster} />
          ))
        ) : (
          <p className="pair-empty">
            {allied ? 'No teammates revealed' : 'No enemies revealed'}
          </p>
        )}
      </div>
    </section>
  );
}

export function ContributionBreakdown({
  row,
  roster,
  includeStrength,
  profile,
}: {
  row: ScoredCandidate;
  roster: Roster;
  includeStrength: boolean;
  profile?: Profile;
}) {
  const candidate = roster.get(row.id);
  const intervals = row.pairs
    .filter((pair) => pair.multiplier > 0)
    .flatMap((pair) => {
      const range = contributionSamplingRange(pair, profile);
      return range ? [{ pair, range }] : [];
    });
  return (
    <>
      <div className="breakdown-head">
        <div className="breakdown-identity">
          <Portrait champion={candidate} className="" />
          <h2>Why {candidate?.name ?? row.id}?</h2>
        </div>
        <div className="breakdown-score">
          <span>Draft edge</span>
          <strong
            className={
              'breakdown-total ' + (row.complete ? tone(row.score) : 'zero')
            }
          >
            {row.complete ? signed(row.score) : 'No data'}
          </strong>
        </div>
      </div>
      <p className="contribution-label">
        Adjusted contribution <span>pp</span>
      </p>
      <div className="contribution-groups">
        <ContributionGroup row={row} kind="ally" roster={roster} />
        <ContributionGroup row={row} kind="enemy" roster={roster} />
      </div>
      {includeStrength && (
        <div className="breakdown-base">
          <span>Base strength</span>
          <strong className={tone(row.base)}>{signed(row.base)}</strong>
          <small>{(row.wr * 100).toFixed(2)}% overall WR vs 50%</small>
        </div>
      )}
      {intervals.length > 0 && (
        <details className="pair-evidence">
          <summary>Contribution sampling ranges</summary>
          <p>
            Approximate 95% ranges for individual contributions, treating
            expected win rates as fixed. Sample Δ shows how far Draft Edge moves
            when all matchup contributions reach their low or high bounds
            together. Base WR stays fixed.
          </p>
          <ul>
            {intervals.map(({ pair, range }) => (
              <li key={pair.id}>
                <span>
                  {pair.kind === 'ally' ? 'With' : 'Against'}{' '}
                  {roster.get(pair.id)?.name ?? pair.id} ·{' '}
                  {ROLE_NAMES[pair.role]}
                </span>
                <span>
                  {signed(range[0])} to {signed(range[1])} pp
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function Breakdown({
  lab,
  spread,
}: {
  lab: DraftLab;
  spread: ReturnType<typeof useSpread>;
}) {
  const {
    state: { draft, roster, includeStrength, clientOwnChampion },
    selected,
    ranking,
    blind,
    roleProfiles,
    catalog,
    pending,
  } = lab;
  const row = pending
    ? undefined
    : ranking?.ranked.find((candidate) => candidate.id === selected);
  const profile = row ? roleProfiles?.[row.id] : undefined;
  const threats = useMemo(
    () =>
      profile && catalog
        ? remainingCounters(profile, catalog.champions, draft, {
            ownChampion: clientOwnChampion,
          })
        : null,
    [profile, catalog, draft, clientOwnChampion],
  );
  return (
    <section id="breakdown" className="breakdown" hidden={!row}>
      <div id="pick-breakdown">
        {row &&
          (row.score === null ? (
            <div className="breakdown-head">
              <div>
                <h2>{roster.get(row.id)?.name}</h2>
                <p>
                  {(100 * row.wr).toFixed(1)}% WR ·{' '}
                  {blind[row.id]?.counterLoss != null
                    ? blind[row.id].counterLoss!.toFixed(2) +
                      ' pp weighted downside'
                    : 'Downside unavailable'}
                </p>
              </div>
              <span className="blind-detail">
                Blindability {spread.cell(row.id, 'breakdown')}
              </span>
            </div>
          ) : (
            <ContributionBreakdown
              row={row}
              roster={roster}
              includeStrength={includeStrength}
              profile={profile}
            />
          ))}
      </div>
      <section
        id="counter-tools"
        className="remaining-counters"
        aria-label="Remaining counters"
        hidden={threats === null}
      >
        <div className="remaining-counters-head">
          <div className="remaining-counters-title">
            <h3>Remaining counters</h3>
            <button
              type="button"
              className="remaining-counter-help"
              popoverTarget="remaining-counter-method"
              aria-label="How remaining counters are ranked"
            >
              ?
            </button>
            {threats !== null && <CounterMethod />}
          </div>
          <p id="remaining-counters-caption" hidden={!threats?.length}>
            Ranked by matchup severity and role pick share
          </p>
        </div>
        <div id="remaining-counters-cards">
          {threats &&
            (threats.length ? (
              <ul className="remaining-counter-list">
                {threats.map((threat) => (
                  <li className="remaining-counter" key={threat.id}>
                    <Portrait champion={roster.get(threat.id)} className="" />
                    <div className="remaining-counter-pick">
                      <strong>
                        {roster.get(threat.id)?.name ?? threat.id}
                      </strong>
                      <small>
                        {ROLE_NAMES[threat.role]} ·{' '}
                        {threat.pickShare.toFixed(1)}% pick share
                      </small>
                    </div>
                    <span
                      className="remaining-counter-effect negative"
                      title={`Sample-adjusted matchup effect from ${threat.games.toLocaleString('en-US')} games`}
                    >
                      {signed(threat.adjusted)} pp
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No available common counters found in the matchup data.</p>
            ))}
        </div>
      </section>
    </section>
  );
}
