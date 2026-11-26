import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ROLE_NAMES } from '../domain/draft-math';
import { customMultipliers } from '../domain/draft-weights';
import { ROLES } from '../domain/types';
import type { Role } from '../domain/types';
import type { CompanionState } from '../services/companion';
import {
  createCompanionOffer,
  waitForCompanion,
} from '../services/companion-session';
import type { CompanionSessionFields } from '../services/companion-session';
import type { DraftLab } from '../useDraftLab';
import { RoleIcon } from './RoleIcon';
import { Dialog } from './shared';

export function Header({
  lab,
  onDownload,
}: {
  lab: DraftLab;
  onDownload: () => void;
}) {
  const { data, entries, catalog, requestedDatasetId, requestDataset } = lab;
  const options = [...(entries?.values() ?? [])].filter(
    (entry) => entry.kind === 'combined' && entry.rank,
  );
  const { entry, patches } = data?.selection ?? { entry: null, patches: [] };
  const filtered = (entry?.patches?.length ?? 0) > patches.length;
  const date = catalog
    ? new Date(catalog.asOf).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Los_Angeles',
      })
    : null;
  const label = filtered
    ? `${patches.length} of ${entry?.patches?.length} patches`
    : entry?.label;
  return (
    <header>
      <a href="./" className="brand">
        <img
          src="assets/draft-lab-mark.png?v=4b98582d5627"
          width="30"
          height="30"
          alt=""
        />
        DRAFTEDGE
      </a>
      <nav>
        <span className="active">Draft picker</span>
        <button
          id="companion-download-open"
          type="button"
          aria-haspopup="dialog"
          aria-controls="companion-download-dialog"
          onClick={onDownload}
        >
          Companion
        </button>
      </nav>
      <div className="header-data">
        <span
          id="snapshot"
          className="snapshot"
          title={filtered ? 'Included patches: ' + patches.join(', ') : ''}
        >
          {catalog
            ? [options.length < 2 ? catalog.rank : null, label, date]
                .filter(Boolean)
                .join(' · ')
            : 'Loading data…'}
        </span>
        <select
          id="rank-dataset"
          aria-label="Rank dataset"
          disabled={!entry}
          hidden={options.length < 2}
          value={requestedDatasetId ?? entry?.id ?? ''}
          onChange={(event) => requestDataset(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.rank}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}

export type CompanionDialogMode = 'open' | 'reconnect' | 'reopen' | 'update';
const recoveryActions: Partial<
  Record<CompanionState['control'], { mode: CompanionDialogMode; label: string }>
> = {
  Offline: { mode: 'reconnect', label: 'Reconnect' },
  Expired: { mode: 'reconnect', label: 'Reconnect' },
  Closed: { mode: 'reopen', label: 'Reopen Companion' },
  Update: { mode: 'update', label: 'Update Companion' },
};

function CompanionControls({
  lab,
  onCompanion,
}: {
  lab: DraftLab;
  onCompanion: (mode: CompanionDialogMode) => void;
}) {
  const { companion, companionState: state } = lab;
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function click(event: MouseEvent) {
      if (
        details.current &&
        event.target instanceof Node &&
        !bar.current?.contains(event.target)
      )
        details.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.open = false;
        trigger.current?.focus();
      }
    }
    document.addEventListener('click', click);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  function closeMenu() {
    if (details.current) details.current.open = false;
    trigger.current?.focus();
  }
  const pauseLabel = state.paused ? 'Resume live sync' : 'Pause live sync';
  const denied = state.control === 'Blocked';
  const recovery = recoveryActions[state.control];
  const needsPermission = state.control === 'Connect' || denied;

  function recover() {
    if (!recovery) return;
    if (state.prompt) companion.current?.dismiss();
    onCompanion(recovery.mode);
  }

  return (
    <>
      <div
        id="companion-bar"
        className="companion-control"
        ref={bar}
        data-state={state.control.toLowerCase()}
      >
        <details id="companion-details" ref={details}>
          <summary id="companion-menu-toggle" ref={trigger}>
            <span className="sync-dot" aria-hidden="true" />
            <span id="companion-chip-label">League · {state.control}</span>
          </summary>
          <div className="companion-menu">
            <h3>League connection</h3>
            <p id="companion-status" role="status">
              {state.message}
            </p>
            {state.quitError && <p role="alert">{state.quitError}</p>}
            {(recovery || needsPermission) && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  closeMenu();
                  if (recovery) recover();
                  else companion.current?.open();
                }}
              >
                {recovery?.label ??
                  (denied ? 'Review local access' : 'Connect to League')}
              </button>
            )}
            {state.connected && (
              <button
                id="quit-companion"
                type="button"
                className="ghost"
                disabled={state.busy}
                onClick={() => {
                  trigger.current?.focus();
                  void companion.current?.quit();
                }}
              >
                {state.busy ? 'Quitting…' : 'Quit companion'}
              </button>
            )}
          </div>
        </details>
        <button
          id="pause-companion"
          className="sync-pause-button"
          type="button"
          aria-label={pauseLabel}
          title={pauseLabel}
          data-paused={state.paused}
          disabled={!state.connected || state.busy}
          onClick={() =>
            state.paused
              ? companion.current?.resume()
              : companion.current?.pause()
          }
        >
          <svg
            className="sync-pause-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M8 5v14M16 5v14"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
          </svg>
          <svg
            className="sync-resume-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m8 5 11 7-11 7z" fill="currentColor" />
          </svg>
        </button>
      </div>
      <Dialog
        id="companion-connect"
        open={state.prompt}
        close={() => companion.current?.dismiss()}
        aria-labelledby="connection-title"
        aria-describedby="connection-description connection-help"
        focus="#connection-connect"
      >
        <div className="picker-head">
          <span className="connection-eyebrow">LIVE DRAFT SYNC</span>
          <button
            id="connection-close"
            aria-label="Close connection setup"
            onClick={() => companion.current?.dismiss()}
          >
            ×
          </button>
        </div>
        <div className="connection-symbol" aria-hidden="true">
          ↔
        </div>
        <h2 id="connection-title">Connect your League client</h2>
        <p id="connection-description">
          Import champion select and update roles when the match starts.
        </p>
        <p id="connection-help">
          {recovery
            ? state.message
            : denied
            ? 'Local access is blocked. Allow it in your browser’s site settings, then try again.'
            : 'Choose Allow when your browser asks to access apps and services on this device.'}
        </p>
        <button
          id="connection-connect"
          className="connection-primary"
          disabled={state.busy}
          onClick={() => {
            if (recovery) recover();
            else void companion.current?.connect();
          }}
        >
          {recovery?.label ?? (denied ? 'Try again' : 'Connect to League')}
        </button>
        <p id="connection-progress" role="status">
          {recovery ? '' : state.progress}
        </p>
        <button
          id="connection-later"
          className="connection-later"
          onClick={() => companion.current?.dismiss()}
        >
          Draft manually for now
        </button>
      </Dialog>
    </>
  );
}

export function Controls({
  lab,
  hasCompanion,
  onCompanion,
  settings,
  changeRole,
  reset,
}: {
  lab: DraftLab;
  hasCompanion: boolean;
  onCompanion: (mode: CompanionDialogMode) => void;
  settings: () => void;
  changeRole: (role: Role) => void;
  reset: () => void;
}) {
  const { state, dispatch, pending, exclusions } = lab;
  const custom = customMultipliers(state.weights) || exclusions.length > 0;
  const showClearPins =
    state.autoRoles &&
    Object.values(state.roleOverrides).some((side) => Object.keys(side).length);
  return (
    <div className="controls">
      <div className="rolecontrol">
        <span id="role-selector-label">Your role</span>
        <div
          className="role-selector"
          role="group"
          aria-labelledby="role-selector-label"
        >
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              className="role-choice"
              data-your-role={role}
              aria-label={'Select ' + ROLE_NAMES[role] + ' role'}
              aria-pressed={role === state.draft.role}
              title={ROLE_NAMES[role]}
              disabled={pending || !lab.initialized}
              onClick={() => changeRole(role)}
            >
              <RoleIcon role={role} />
              <span>{ROLE_NAMES[role]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        <button
          id="clear-role-pins"
          className="ghost"
          type="button"
          hidden={!showClearPins}
          title="Let DraftEdge guess pinned roles again"
          onClick={() => dispatch({ type: 'clearCorrections' })}
        >
          Clear role pins
        </button>
        <button
          id="draft-settings"
          className="ghost"
          aria-haspopup="dialog"
          aria-controls="draft-settings-dialog"
          onClick={settings}
        >
          {custom ? 'Settings · custom' : 'Settings'}
        </button>
        <button id="reset" className="ghost" onClick={reset}>
          Reset draft
        </button>
        {hasCompanion && lab.initialized && (
          <CompanionControls lab={lab} onCompanion={onCompanion} />
        )}
      </div>
    </div>
  );
}

export function CompanionDialog({
  mode,
  close,
  onPaired,
  retryConnection,
}: {
  mode: CompanionDialogMode | null;
  close: () => void;
  onPaired: (session: CompanionSessionFields) => void;
  retryConnection?: () => void;
}) {
  const [offer, setOffer] = useState(createCompanionOffer);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pairing = useRef<AbortController | null>(null);
  useEffect(() => () => pairing.current?.abort(), []);

  function closeDialog() {
    pairing.current?.abort();
    pairing.current = null;
    setBusy(false);
    setMessage('');
    setOffer(createCompanionOffer());
    close();
  }

  async function openCompanion(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (!offer || pairing.current) {
      event.preventDefault();
      return;
    }
    const attempt = new AbortController();
    pairing.current = attempt;
    setBusy(true);
    setMessage(
      'Allow the companion to open and grant local access if prompted.',
    );
    const result = await waitForCompanion(offer, attempt.signal).catch(
      () => null,
    );
    if (attempt.signal.aborted) return;
    pairing.current = null;
    setBusy(false);
    setOffer(createCompanionOffer());
    if (result === 'blocked') {
      setMessage(
        'Allow local access in your browser’s site settings, then try Open Companion again.',
      );
    } else if (!result) {
      setMessage('Could not reach the companion. Check that it opened, then try again.');
    } else {
      setMessage('');
      onPaired(result);
    }
  }

  return (
    <Dialog
      id="companion-download-dialog"
      open={mode !== null}
      close={closeDialog}
      focus=".companion-download-button"
      aria-labelledby="companion-download-title"
      aria-describedby="companion-download-description companion-download-requirements"
    >
      <div className="picker-head">
        <h2 id="companion-download-title">DraftEdge Companion</h2>
        <button
          id="companion-download-close"
          type="button"
          aria-label="Close companion setup"
          onClick={closeDialog}
        >
          ×
        </button>
      </div>
      <p id="companion-download-description">
        {mode === 'update'
          ? 'Install the latest companion to reconnect this tab.'
          : mode === 'reconnect' || mode === 'reopen'
            ? 'Open the companion to reconnect League to this tab.'
            : 'Connect this tab to League to import picks, bans, and your assigned role.'}
      </p>
      <div className="companion-download-actions">
        {offer && mode !== 'update' && (
          <a
            className="companion-download-button"
            href={offer.url}
            onClick={(event) => void openCompanion(event)}
            aria-disabled={busy}
          >
            {busy ? 'Connecting…' : 'Open Companion'}
          </a>
        )}
        {mode === 'reconnect' && retryConnection && (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => {
              closeDialog();
              retryConnection();
            }}
          >
            Retry existing connection
          </button>
        )}
        <a
          className={
            offer && mode !== 'update' ? 'ghost' : 'companion-download-button'
          }
          href="https://github.com/pant4321/draft-lab/releases/latest/download/DraftEdgeCompanionSetup.exe"
        >
          Download installer
        </a>
      </div>
      {message && (
        <p className="companion-download-help" role="status">
          {message}
        </p>
      )}
      <p id="companion-download-requirements">
        Windows x64 · League client required. Windows may warn when opening the
        unsigned beta installer.
      </p>
      <p className="companion-download-help">
        {mode !== 'update' &&
          offer &&
          'If the app doesn’t open, install it or search Start for DraftEdge Companion. '}
        <a href="https://github.com/pant4321/draft-lab/releases/latest">
          Portable release
        </a>
      </p>
    </Dialog>
  );
}
