import { isChampionId, isRecord, isRole } from '../domain/types';
import type { ClientPick, ClientSnapshot } from '../domain/types';
import {
  forgetCompanionSession,
  loopbackPermission,
} from './companion-session';
import type { CompanionSession } from './companion-session';

type BridgeState = {
  status: string;
  message: string;
  revision: number;
  snapshot: ClientSnapshot | null;
};
type Control =
  | 'Connect'
  | 'Connecting'
  | 'Live'
  | 'Paused'
  | 'Blocked'
  | 'Offline'
  | 'Expired'
  | 'Update'
  | 'Closed'
  | 'Error';
export type CompanionState = {
  control: Control;
  message: string;
  progress: string;
  connected: boolean;
  paused: boolean;
  syncing: boolean;
  busy: boolean;
  prompt: boolean;
  showConnect: boolean;
};
export type CompanionClient = ReturnType<typeof createCompanionClient>;
export type CompanionConnector = (
  onChange: (state: CompanionState, snapshot?: ClientSnapshot) => void,
) => CompanionClient;
const promptMessage =
  'Connect to allow this page to read champion select from your companion.';
export const initialCompanionState: CompanionState = {
  control: 'Connect',
  message: promptMessage,
  progress: '',
  connected: false,
  paused: false,
  syncing: false,
  busy: false,
  prompt: false,
  showConnect: true,
};

function readPicks(value: unknown): ClientPick[] {
  return Array.isArray(value)
    ? value.flatMap((pick) =>
        isRecord(pick) && isChampionId(pick.id)
          ? [{ id: pick.id, role: isRole(pick.role) ? pick.role : null }]
          : [],
      )
    : [];
}

function readState(value: unknown): BridgeState {
  if (!isRecord(value) || value.bridgeProtocol !== 1) throw Error('version');
  if (
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    typeof value.status !== 'string' ||
    typeof value.message !== 'string'
  )
    throw Error('connection');
  const raw = value.snapshot;
  const snapshot =
    isRecord(raw) && typeof raw.sessionId === 'string'
      ? {
          sessionId: raw.sessionId,
          playerRole: isRole(raw.playerRole) ? raw.playerRole : null,
          playerChampion: isChampionId(raw.playerChampion)
            ? raw.playerChampion
            : null,
          allies: readPicks(raw.allies),
          enemies: readPicks(raw.enemies),
          bans: Array.isArray(raw.bans) ? raw.bans.filter(isChampionId) : [],
        }
      : null;
  return {
    status: value.status,
    message: value.message,
    revision: value.revision,
    snapshot,
  };
}

export function createCompanionClient(
  session: CompanionSession,
  onChange: (state: CompanionState, snapshot?: ClientSnapshot) => void,
  environment = globalThis,
) {
  let state = { ...initialCompanionState };
  let bridge: BridgeState | null = null;
  let stopped = false;
  let expired = false;
  let permission: PermissionStatus | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollRequest: AbortController | null = null;
  let quitRequest: AbortController | null = null;

  function publish(next: Partial<CompanionState>, importSnapshot = false) {
    state = { ...state, ...next };
    state.syncing =
      state.connected && !state.paused && bridge?.status === 'champ_select';
    onChange(
      state,
      importSnapshot && state.syncing
        ? (bridge?.snapshot ?? undefined)
        : undefined,
    );
  }

  function stopTimer() {
    if (timer !== undefined) environment.clearTimeout(timer);
    timer = undefined;
  }

  function request(
    path: '/api/state' | '/api/quit',
    controller: AbortController,
  ) {
    const init = {
      method: path === '/api/quit' ? 'POST' : 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      targetAddressSpace: 'loopback',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      headers: { 'X-DraftLab-Session': session.token },
    } satisfies RequestInit & { targetAddressSpace: string };
    return environment.fetch(session.origin + path, init);
  }

  async function poll() {
    if (stopped || expired || pollRequest || quitRequest) return;
    stopTimer();
    const controller = new AbortController();
    pollRequest = controller;
    publish({
      busy: true,
      ...(state.connected ? {} : { control: 'Connecting' }),
    });
    try {
      const response = await request('/api/state', controller);
      if (controller.signal.aborted || stopped) return;
      if (response.status === 403) {
        expired = true;
        forgetCompanionSession(environment);
        throw Error('session');
      }
      if (!response.ok) throw Error('connection');
      const next = readState(await response.json());
      if (controller.signal.aborted || stopped) return;
      const changed = !state.connected || next.revision !== bridge?.revision;
      bridge = next;
      publish(
        {
          connected: true,
          control: state.paused ? 'Paused' : 'Live',
          message: state.paused ? 'Sync paused' : next.message,
          prompt: false,
          showConnect: false,
          progress: '',
        },
        changed,
      );
      timer = environment.setTimeout(poll, 750);
    } catch (error) {
      if (controller.signal.aborted || stopped) return;
      const wasConnected = state.connected;
      const reason = error instanceof Error ? error.message : '';
      bridge = null;
      const control =
        reason === 'session'
          ? 'Expired'
          : reason === 'version'
            ? 'Update'
            : permission?.state === 'denied'
              ? 'Blocked'
              : 'Offline';
      const message =
        control === 'Expired'
          ? 'Companion session expired. Open Draft Lab from its launcher again.'
          : control === 'Update'
            ? 'Update the companion to connect to this website.'
            : control === 'Blocked'
              ? 'Allow local companion access in your browser’s site settings, then reconnect.'
              : 'Companion unavailable. Keep it running and allow local access when your browser asks.';
      publish({
        connected: false,
        control,
        message,
        progress: message,
        showConnect: true,
      });
      if (wasConnected && control === 'Offline')
        timer = environment.setTimeout(poll, 3000);
    } finally {
      pollRequest = null;
      if (!stopped && !quitRequest) publish({ busy: false });
      // A grant can arrive while the aborted request is still unwinding.
      if (
        controller.signal.aborted &&
        !stopped &&
        permission?.state === 'granted'
      )
        void poll();
    }
  }

  function permissionChanged() {
    if (stopped || expired) return;
    if (permission?.state === 'granted') {
      void poll();
      return;
    }
    stopTimer();
    pollRequest?.abort();
    bridge = null;
    const denied = permission?.state === 'denied';
    publish({
      connected: false,
      control: denied ? 'Blocked' : 'Connect',
      prompt: true,
      showConnect: true,
      progress: '',
      message: denied
        ? 'Allow local companion access in your browser’s site settings, then reconnect.'
        : promptMessage,
    });
  }

  function setPaused(paused: boolean) {
    if (!state.connected) return;
    publish(
      {
        paused,
        control: paused ? 'Paused' : 'Live',
        message: paused
          ? 'Sync paused'
          : (bridge?.message ?? 'Connecting to League…'),
      },
      !paused,
    );
  }

  return {
    async start() {
      const status = await loopbackPermission(environment.navigator);
      if (stopped) return;
      permission = status;
      permission?.addEventListener('change', permissionChanged);
      if (!pollRequest && !state.connected) permissionChanged();
    },
    open() {
      if (stopped || expired) return;
      if (permission?.state === 'granted') void poll();
      else publish({ prompt: true, progress: '' });
    },
    dismiss() {
      publish({ prompt: false });
    },
    connect() {
      publish({
        message: 'Connecting to League…',
        progress: 'Choose Allow in the browser prompt to finish connecting.',
      });
      return poll();
    },
    pause() {
      setPaused(true);
    },
    resume() {
      setPaused(false);
    },
    async quit() {
      if (!state.connected || stopped || quitRequest) return;
      const controller = new AbortController();
      quitRequest = controller;
      stopTimer();
      pollRequest?.abort();
      publish({ busy: true });
      try {
        const response = await request('/api/quit', controller);
        if (!response.ok) throw Error('quit');
        if (stopped) return;
        stopped = true;
        permission?.removeEventListener('change', permissionChanged);
        forgetCompanionSession(environment);
        bridge = null;
        publish({
          connected: false,
          showConnect: false,
          prompt: false,
          busy: false,
          control: 'Closed',
          message: 'Companion closed',
        });
      } catch {
        if (!stopped) {
          publish({
            busy: false,
            control: 'Error',
            message: 'Could not close the companion. Use Quit in its launcher.',
          });
          timer = environment.setTimeout(poll, 750);
        }
      } finally {
        quitRequest = null;
      }
    },
    dispose() {
      stopped = true;
      stopTimer();
      permission?.removeEventListener('change', permissionChanged);
      pollRequest?.abort();
      quitRequest?.abort();
    },
  };
}
