import { useLayoutEffect, useMemo, useRef } from 'react';
import { suggestedPoolBans } from '../domain/blindability';
import type { PoolThreat } from '../domain/blindability';
import { ROLE_NAMES } from '../domain/draft-math';
import { neededRoles } from '../domain/draft-state';
import { scoreTeamDraft } from '../domain/team-edge';
import type { Roster, Side } from '../domain/types';
import { blockedChampions } from '../services/storage';
import type { DraftLab } from '../useDraftLab';
import { Portrait, signed, tone } from './shared';

function priority(value: number) {
  return value === 0 ? '0' : value < 0.001 ? '<0.001' : value.toFixed(3);
}

function BanSuggestion({
  threat,
  roster,
}: {
  threat: PoolThreat;
  roster: Roster;
}) {
  const {
    id,
    role,
    pickShare,
    affected,
    poolSize,
    worst,
    contributions,
    risk,
  } = threat;
  const opponent = roster.get(id)?.name ?? String(id);
  const poolPick = roster.get(worst.id)?.name ?? String(worst.id);
  return (
    <li>
      <details name="pool-ban-matchups" data-pool-ban-id={id}>
        <summary className="pool-ban-entry">
          <Portrait champion={roster.get(id)} className="" />
          <span className="pool-ban-details">
            <span className="pool-ban-summary">
              <strong>{opponent}</strong>
              <small>
                {ROLE_NAMES[role]} · {pickShare.toFixed(1)}% pick share
              </small>
            </span>
            <span className="pool-ban-impact">
              <span>
                Hurts {affected} of {poolSize} pool picks
              </span>
              <span>
                Hardest on {poolPick}{' '}
                <strong
                  className="negative"
                  title={`Sample-adjusted effect from ${worst.games.toLocaleString('en-US')} games`}
                >
                  {signed(worst.adjusted)} pp
                </strong>
              </span>
            </span>
          </span>
        </summary>
        <table
          className="pool-ban-table"
          aria-label={'Pool matchups against ' + opponent}
        >
          <thead>
            <tr>
              <th scope="col">Pool pick</th>
              <th scope="col">Matchup</th>
              <th scope="col">Ban score</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((part) => (
              <tr key={part.id}>
                <th scope="row">{roster.get(part.id)?.name ?? part.id}</th>
                <td
                  className={tone(part.adjusted)}
                  title={`Sample-adjusted effect from ${part.games.toLocaleString('en-US')} games`}
                >
                  {signed(part.adjusted)} pp
                </td>
                <td>{priority(part.priority)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total ban score
              </th>
              <td>{priority(risk)}</td>
            </tr>
          </tfoot>
        </table>
      </details>
    </li>
  );
}

export function Bans({ lab, add }: { lab: DraftLab; add: () => void }) {
  const {
    state: { roster, draft, pools, clientOwnChampion },
    pending,
    roleProfiles,
    catalog,
    manual,
  } = lab;
  const pool = pools[draft.role];
  const threats = useMemo(
    () =>
      roleProfiles && catalog
        ? suggestedPoolBans(roleProfiles, pool, catalog.champions, draft, {
            ownChampion: clientOwnChampion,
          })
        : null,
    [roleProfiles, pool, catalog, draft, clientOwnChampion],
  );
  const popover = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const unavailable = pending || !roleProfiles;
  useLayoutEffect(() => {
    if (unavailable && popover.current?.matches(':popover-open'))
      popover.current.hidePopover();
    if (
      lastFocused.current &&
      !lastFocused.current.isConnected &&
      popover.current?.matches(':popover-open')
    ) {
      button.current?.focus({ preventScroll: true });
      lastFocused.current = null;
    }
  }, [unavailable, threats]);
  return (
    <section className="bans">
      <span className="small-label">BANS</span>
      <div id="ban-chips">
        {draft.bans.map((id) => (
          <button
            key={id}
            className="ban-chip"
            disabled={pending}
            data-unban={id}
            aria-label={'Unban ' + roster.get(id)?.name}
            onClick={() => manual({ type: 'ban', id })}
          >
            <Portrait champion={roster.get(id)} className="" />
            <span>{roster.get(id)?.name} ×</span>
          </button>
        ))}
      </div>
      <button
        id="add-ban"
        className="add-ban"
        disabled={pending || !lab.initialized}
        onClick={add}
      >
        + Add ban
      </button>
      <button
        id="pool-bans-button"
        className="ghost"
        type="button"
        disabled={unavailable}
        popoverTarget="pool-bans-popover"
        ref={button}
      >
        Suggested bans for your pool
      </button>
      <section
        id="pool-bans-popover"
        aria-labelledby="pool-bans-title"
        popover="auto"
        ref={popover}
        onFocus={(event) => {
          if (event.target instanceof HTMLElement)
            lastFocused.current = event.target;
        }}
      >
        <h3 id="pool-bans-title">Suggested bans</h3>
        <div id="pool-bans-list" aria-live="polite">
          {!threats?.length ? (
            pool.length ? (
              <p>No bans to suggest for this pool.</p>
            ) : (
              <p>
                Add champions to <strong>Your pool</strong> to get suggestions.
              </p>
            )
          ) : (
            <>
              <p className="pool-ban-note">
                Pool picks count equally. Open a suggestion to see each matchup.
              </p>
              <ol className="pool-ban-list">
                {threats.map((threat) => (
                  <BanSuggestion
                    key={threat.id}
                    threat={threat}
                    roster={roster}
                  />
                ))}
              </ol>
            </>
          )}
        </div>
      </section>
    </section>
  );
}

const display = (value?: number | null) =>
  value == null ? '—' : signed(value);
const color = (value?: number | null) => (value == null ? 'zero' : tone(value));

function TeamEdgeScore({
  lab,
  side,
  ownChampion,
}: {
  lab: DraftLab;
  side: Side;
  ownChampion: number | null;
}) {
  const { state, options, pending, data, profileErrors } = lab;
  const { draft, includeStrength, clientOwnChampion } = state;
  const allies = side === 'allies';
  const titleId = `team-edge-${side}-title`;
  const roles = neededRoles(state, side);
  const profileError = roles.some((role) => profileErrors[role]);
  const profiles = data?.profiles;
  const loading = pending || roles.some((role) => !profiles?.[role]);
  const estimate = useMemo(
    () =>
      profiles && !loading && !profileError
        ? scoreTeamDraft(draft, profiles, { ...options, ownChampion, side })
        : null,
    [draft, profiles, loading, profileError, ownChampion, options, side],
  );
  const total = estimate?.ready ? estimate : null;
  const sampleRange = total?.sampleRange;
  const note = profileError
    ? 'Role data could not be loaded.'
    : total && !total.complete
      ? 'Some selected roles are missing matchup data.'
      : '';
  return (
    <section className={`team-edge-team ${allies ? 'ally' : 'enemy'}`} aria-labelledby={titleId}>
      <div className="team-edge-main">
        <h3 id={titleId}>{allies ? 'Your team' : 'Enemy team'}</h3>
        <div className="team-edge-estimate">
          <output
            aria-label={allies ? 'Allied draft edge' : 'Enemy draft edge'}
            className={'team-edge-total ' + color(total?.score)}
            aria-live="polite"
            aria-atomic="true"
            title={
              loading && !profileError
                ? 'Calculating team edge'
                : ownChampion !== null && clientOwnChampion === null
                  ? 'Includes your selected champion preview'
                  : undefined
            }
          >
            {display(total?.score)}
          </output>
          {total?.score != null && (
            <span
              className="team-edge-sampling"
              title={
                sampleRange
                  ? 'Shows the low and high ends of the total team edge, accounting for how uncertain each matchup estimate is given the number of games played.'
                  : 'The team edge range needs at least one matchup and enough data to estimate a range for every matchup that counts.'
              }
            >
              Team edge range{' '}
              <span>
                {sampleRange
                  ? `${signed(sampleRange[0])} to ${signed(sampleRange[1])}`
                  : '—'}
              </span>
            </span>
          )}
        </div>
      </div>
      <dl className="team-edge-parts">
        <div>
          <dt>Counters</dt>
          <dd className={color(total?.counter)}>
            {display(total?.counter)}
          </dd>
        </div>
        <div>
          <dt>Synergy</dt>
          <dd className={color(total?.synergy)}>
            {display(total?.synergy)}
          </dd>
        </div>
        <div hidden={!includeStrength}>
          <dt>Base strength</dt>
          <dd className={color(total?.base)}>
            {display(total?.base)}
          </dd>
        </div>
      </dl>
      {note && <p className="team-edge-note">{note}</p>}
    </section>
  );
}

export function TeamEdge({ lab }: { lab: DraftLab }) {
  const { draft } = lab.state;
  const own = lab.liveChampion?.id ?? lab.selected;
  const ownChampion = blockedChampions(draft).includes(own) ? null : own;
  return (
    <section className="team-edge" aria-labelledby="team-edge-title">
      <h2 id="team-edge-title">Team draft edge</h2>
      <div className="team-edge-teams">
        <TeamEdgeScore lab={lab} side="allies" ownChampion={ownChampion} />
        <TeamEdgeScore lab={lab} side="enemies" ownChampion={ownChampion} />
      </div>
    </section>
  );
}
