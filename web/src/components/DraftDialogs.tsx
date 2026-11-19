import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sortPickerChampions } from '../domain/draft-list';
import { ROLE_NAMES } from '../domain/draft-math';
import { defaultMultipliers } from '../domain/draft-weights';
import { ROLES, SIDES } from '../domain/types';
import type { Role, Side } from '../domain/types';
import type { DraftLab } from '../useDraftLab';
import type { PickerTarget } from './DraftBoard';
import { Dialog, norm, Portrait } from './shared';

export function ChampionPicker({
  lab,
  target,
  close,
}: {
  lab: DraftLab;
  target: PickerTarget | null;
  close: () => void;
}) {
  const {
    state: { draft, roster },
    dispatch,
  } = lab;
  const [search, setSearch] = useState('');
  const searchBox = useRef<HTMLInputElement>(null);
  const position = target && 'side' in target ? target : null;
  const ban = target !== null && 'ban' in target;
  const role = position?.role ?? draft.role;
  const taken = new Set([
    ...Object.values(draft.allies),
    ...Object.values(draft.enemies),
  ]);
  if (position) taken.delete(draft[position.side][position.role]);
  const champions = useMemo(
    () => sortPickerChampions(roster.values(), role),
    [roster, role],
  );
  const visible = target
    ? champions.filter((champion) => norm(champion.name).includes(norm(search)))
    : [];
  function pick(id: number) {
    if (ban) {
      dispatch({ type: 'ban', id });
      searchBox.current?.focus();
    } else if (position) {
      dispatch({ type: 'pick', ...position, id });
      close();
    }
  }
  return (
    <Dialog
      id="champion-picker"
      open={target !== null}
      close={close}
      focus="#picker-search"
      aria-labelledby="picker-title"
    >
      <div className="picker-head">
        <h2 id="picker-title">
          {ban
            ? 'Choose bans'
            : position
              ? `Choose ${position.side === 'allies' ? 'allied' : 'enemy'} ${ROLE_NAMES[role]}`
              : 'Choose champion'}
        </h2>
        <button
          id="close-picker"
          aria-label="Close champion picker"
          onClick={close}
        >
          ×
        </button>
      </div>
      <input
        ref={searchBox}
        id="picker-search"
        type="search"
        placeholder="Search champions…"
        aria-label="Search champions"
        autoComplete="off"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <p id="picker-order" className="picker-order">
        Most played in {ROLE_NAMES[role]}
      </p>
      <div id="picker-list" className="picker-list">
        {visible.length ? (
          visible.map((champion) => {
            const banned = draft.bans.includes(champion.id);
            return (
              <button
                key={champion.id}
                className={'champ-option' + (banned ? ' banned' : '')}
                data-pick={champion.id}
                disabled={taken.has(champion.id) || (!ban && banned)}
                aria-label={
                  (ban ? (banned ? 'Unban ' : 'Ban ') : 'Pick ') + champion.name
                }
                onClick={() => pick(champion.id)}
              >
                <Portrait champion={champion} className="" />
                <span>{champion.name}</span>
              </button>
            );
          })
        ) : (
          <p>No champions found.</p>
        )}
      </div>
    </Dialog>
  );
}

export function PoolPicker({
  lab,
  role,
  close,
}: {
  lab: DraftLab;
  role: Role | null;
  close: () => void;
}) {
  const {
    state: { pools, roster, draft },
    data,
    dispatch,
  } = lab;
  const activeRole = role ?? draft.role;
  const chosen = pools[activeRole];
  const profiles = data?.profiles[activeRole];
  const [search, setSearch] = useState('');
  const results = useRef<HTMLDivElement>(null);
  const champions = useMemo(
    () => sortPickerChampions(roster.values(), activeRole),
    [roster, activeRole],
  );
  const visible = role
    ? champions.filter(
        (champion) =>
          profiles?.[champion.id] && norm(champion.name).includes(norm(search)),
      )
    : [];
  const roleName = ROLE_NAMES[activeRole];
  function toggle(id: number) {
    dispatch({ type: 'pool', role: activeRole, id });
    results.current
      ?.querySelector<HTMLButtonElement>(`[data-pool-pick="${id}"]`)
      ?.focus({ preventScroll: true });
  }
  return (
    <Dialog
      id="pool-picker"
      open={role !== null}
      close={close}
      focus="#pool-search"
      aria-labelledby="pool-title"
    >
      <div className="picker-head">
        <h2 id="pool-title">Your {roleName} pool</h2>
        <button
          id="close-pool"
          aria-label="Close champion pool"
          onClick={close}
        >
          ×
        </button>
      </div>
      <input
        id="pool-search"
        type="search"
        placeholder="Search champions…"
        aria-label="Search your champion pool"
        autoComplete="off"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <div id="pool-selected" className="pool-selected">
        {chosen.map((id) => {
          const champion = roster.get(id);
          return (
            champion && (
              <button
                key={id}
                className="pool-chip"
                data-pool-remove={id}
                aria-label={`Remove ${champion.name} from your ${roleName} pool`}
                onClick={() => toggle(id)}
              >
                <Portrait champion={champion} className="" />
                <span>{champion.name} ×</span>
              </button>
            )
          );
        })}
      </div>
      <div id="pool-list" className="picker-list" ref={results}>
        {visible.length ? (
          visible.map((champion) => {
            const included = chosen.includes(champion.id);
            return (
              <button
                key={champion.id}
                className={
                  'champ-option pool-choice' + (included ? ' in-pool' : '')
                }
                data-pool-pick={champion.id}
                aria-pressed={included}
                aria-label={
                  included
                    ? `Remove ${champion.name} from your ${roleName} pool`
                    : `Add ${champion.name} to your ${roleName} pool`
                }
                onClick={() => toggle(champion.id)}
              >
                <Portrait champion={champion} className="" />
                <span>{champion.name}</span>
              </button>
            );
          })
        ) : (
          <p>No champions found.</p>
        )}
      </div>
      <div className="pool-footer">
        <span id="pool-count">
          {chosen.length} {chosen.length === 1 ? 'champion' : 'champions'}
        </span>
        <div>
          <button
            id="clear-pool"
            className="ghost"
            hidden={!chosen.length}
            onClick={() => dispatch({ type: 'pool', role: activeRole })}
          >
            Clear pool
          </button>
          <button id="pool-done" className="ghost" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function SettingsDialog({
  lab,
  open,
  close,
}: {
  lab: DraftLab;
  open: boolean;
  close: () => void;
}) {
  const { state, dispatch, data, pending, exclusions, requestDataset } = lab;
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<
    Partial<Record<`${Side}:${Role}`, string>>
  >({});
  const disclosure = useRef<HTMLDetailsElement>(null);
  const table = useRef<HTMLTableSectionElement>(null);
  const selection = data?.selection;
  const patches = selection?.entry.patches ?? [];
  const count = patches.length - unchecked.length;
  useLayoutEffect(() => {
    if (open) setUnchecked(exclusions);
  }, [open, exclusions]);
  useLayoutEffect(() => {
    if (open && disclosure.current) disclosure.current.open = false;
    setInvalid({});
  }, [open]);

  function done() {
    const input = Array.from(
      table.current?.querySelectorAll('input') ?? [],
    ).find((input) => !input.validity.valid);
    if (input) {
      input.reportValidity();
      return;
    }
    close();
    if (
      selection &&
      !pending &&
      patches.some(
        (patch) => unchecked.includes(patch) !== exclusions.includes(patch),
      )
    ) {
      requestDataset(selection.entry.id, unchecked);
    }
  }

  return (
    <Dialog
      id="draft-settings-dialog"
      open={open}
      close={close}
      aria-labelledby="settings-title"
      aria-describedby="settings-description"
    >
      <div className="picker-head">
        <h2 id="settings-title">Draft settings</h2>
        <button
          id="close-settings"
          aria-label="Close draft settings"
          onClick={close}
        >
          ×
        </button>
      </div>
      <p id="settings-description">
        Choose the patches used for recommendations and adjust how much each
        role contributes to Draft Edge.
      </p>
      <table className="weight-table">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">
              Synergy<small>Your team</small>
            </th>
            <th scope="col">
              Counters<small>Enemy team</small>
            </th>
          </tr>
        </thead>
        <tbody id="weight-rows" ref={table}>
          {ROLES.map((role) => (
            <tr key={role}>
              <th scope="row">{ROLE_NAMES[role]}</th>
              {SIDES.map((side) => {
                const key = `${side}:${role}` as const;
                return (
                  <td key={side}>
                    <label className="weight-input">
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        required
                        data-weight-side={side}
                        data-weight-role={role}
                        value={invalid[key] ?? state.weights[side][role]}
                        aria-label={`${ROLE_NAMES[role]} ${side === 'allies' ? 'synergy' : 'counter'} multiplier`}
                        onChange={(event) => {
                          const input = event.currentTarget;
                          if (!input.validity.valid) {
                            setInvalid((previous) => ({
                              ...previous,
                              [key]: input.value,
                            }));
                            return;
                          }
                          setInvalid((previous) => ({
                            ...previous,
                            [key]: undefined,
                          }));
                          dispatch({
                            type: 'weights',
                            weights: {
                              ...state.weights,
                              [side]: {
                                ...state.weights[side],
                                [role]: input.valueAsNumber,
                              },
                            },
                          });
                        }}
                      />
                      <span aria-hidden="true">×</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="weights-hint">0 ignores · 1 normal · 2 doubles</p>
      <p id="weights-error" role="alert">
        {Object.values(invalid).some((value) => value !== undefined)
          ? 'Use a number from 0 to 5 in steps of 0.1.'
          : ''}
      </p>
      <section className="settings-role-guess">
        <label className="settings-toggle">
          <input
            id="auto-roles"
            type="checkbox"
            checked={state.autoRoles}
            aria-describedby="auto-roles-help auto-roles-sync-note"
            disabled={state.syncing}
            onChange={(event) =>
              dispatch({
                type: 'autoRoles',
                enabled: event.currentTarget.checked,
              })
            }
          />
          <span>Auto guess roles</span>
        </label>
        <p id="auto-roles-help">
          Estimate enemy champions’ roles based on their positional popularity.
        </p>
        <p id="auto-roles-sync-note" hidden={!state.syncing}>
          Enabled automatically while live sync is active.
        </p>
      </section>
      <details id="patch-settings" ref={disclosure} hidden={patches.length < 2}>
        <summary>Patches</summary>
        <fieldset
          id="patch-controls"
          aria-describedby="patch-warning"
          disabled={pending}
        >
          <legend>Include patches</legend>
          <div id="patch-options">
            {patches.map((patch) => {
              const checked = !unchecked.includes(patch);
              return (
                <label className="patch-choice" key={patch}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={checked && count === 1}
                    onChange={(event) => {
                      const included = event.currentTarget.checked;
                      setUnchecked((previous) =>
                        included
                          ? previous.filter((value) => value !== patch)
                          : [...previous, patch],
                      );
                    }}
                  />
                  {patch}
                </label>
              );
            })}
          </div>
          <p id="patch-count" aria-live="polite">
            {count} of {patches.length} patches selected
            {count === 1 ? ' · Keep at least one patch' : ''}
          </p>
          <p id="patch-warning">
            Fewer games make the stats more variable. With very few games,
            apparent matchup or synergy effects may just be noise.
          </p>
        </fieldset>
      </details>
      <div className="settings-footer">
        <button
          id="reset-weights"
          className="ghost"
          onClick={() => {
            setInvalid({});
            dispatch({ type: 'weights', weights: defaultMultipliers() });
          }}
        >
          Reset multipliers
        </button>
        <button id="settings-done" className="ghost" onClick={done}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
