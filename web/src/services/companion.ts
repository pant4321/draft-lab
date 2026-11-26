import { isChampionId, isRecord, isRole } from '../domain/types';
import type { ClientMatchPick, ClientPick, ClientSnapshot } from '../domain/types';
import {
  forgetCompanionReconnect,
  forgetCompanionSession,
  loopbackPermission,
  reconnectCompanion,
  rememberCompanionReconnect,
  rememberCompanionSession,
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
  | 'Waiting'
  | 'Ready'
  | 'Live'
  | 'Paused'
  | 'Unsupported'
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
  quitError: string;
  connected: boolean;
  paused: boolean;
  syncing: boolean;
  busy: boolean;
  prompt: boolean;
};
export type CompanionClient = ReturnType<typeof createCompanionClient>;
export type CompanionConnector = (
  onChange: (state: CompanionState, snapshot?: ClientSnapshot) => void,
) => CompanionClient;
const promptMessage =
  'Connect to sync champion select and match roles from your companion.';
export const initialCompanionState: CompanionState = {
  control: 'Connect',
  message: promptMessage,
  progress: '',
  quitError: '',
  connected: false,
  paused: false,
  syncing: false,
  busy: false,
  prompt: false,
};

function leagueControl(bridge: BridgeState | null): Control {
  switch (bridge?.status) {
    case 'champ_select':
    case 'in_game':
      return 'Live';
    case 'connected':
      return 'Ready';
    case 'unsupported_draft':
      return 'Unsupported';
    case 'connection_error':
      return 'Error';
    default:
      return 'Waiting';
  }
}

function readPicks(value: unknown): ClientPick[] {
  return Array.isArray(value)
    ? value.flatMap((pick) =>
        isRecord(pick) && isChampionId(pick.id)
          ? [{ id: pick.id, role: isRole(pick.role) ? pick.role : null }]
          : [],
      )
    : [];
}

function readMatchPick(value: unknown): ClientMatchPick | null {
  return isRecord(value) &&
    typeof value.key === 'string' &&
    /^[a-z0-9]+$/i.test(value.key) &&
    isRole(value.role)
    ? { key: value.key.toLowerCase(), role: value.role }
    : null;
}

function readSnapshot(raw: unknown): ClientSnapshot | null {
  if (!isRecord(raw) || typeof raw.sessionId !== 'string') return null;
  const sessionId = raw.sessionId;
  const bans = Array.isArray(raw.bans) ? raw.bans.filter(isChampionId) : [];
  if (raw.phase === 'game') {
    const player = readMatchPick(raw.player);
    if (!player || !Array.isArray(raw.allies) || !Array.isArray(raw.enemies)) return null;
    const allies = raw.allies.map(readMatchPick);
    const enemies = raw.enemies.map(readMatchPick);
    if (
      allies.length !== 4 ||
      enemies.length !== 5 ||
      !allies.every((pick) => pick !== null) ||
      !enemies.every((pick) => pick !== null)
    )
      return null;
    return { phase: 'game', sessionId, player, allies, enemies, bans };
  }
  return {
    sessionId,
    playerRole: isRole(raw.playerRole) ? raw.playerRole : null,
    playerChampion: isChampionId(raw.playerChampion) ? raw.playerChampion : null,
    allies: readPicks(raw.allies),
    enemies: readPicks(raw.enemies),
    bans,
  };
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
  return {
    status: value.status,
    message: value.message,
    revision: value.revision,
    snapshot: readSnapshot(value.snapshot),
  };
}

export function createCompanionClient(
  session: CompanionSession,
  onChange: (state: CompanionState, snapshot?: ClientSnapshot) => void,
  environment = globalThis,
) {
  let state = { ...initialCompanionState };
  let bridge: BridgeState | null = null;
  let activeSession = session;
  let stopped = false;
  let expired = false;
  let triedRemembering = false;
  let permission: PermissionStatus | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollRequest: AbortController | null = null;
  let quitRequest: AbortController | null = null;

  function publish(next: Partial<CompanionState>, importSnapshot = false) {
    state = { ...state, ...next };
    state.syncing =
      state.connected &&
      !state.paused &&
      (bridge?.status === 'champ_select' || bridge?.status === 'in_game');
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
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      targetAddressSpace: 'loopback',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      headers: { 'X-DraftLab-Session': activeSession.token },
    } satisfies RequestInit & { targetAddressSpace: string };
    const query = path === '/api/state' && !triedRemembering ? '?remember=1' : '';
    return environment.fetch(activeSession.origin + path + query, init);
  }

  async function poll() {
    if (stopped || expired || pollRequest || quitRequest) return;
    stopTimer();
    const controller = new AbortController();
    pollRequest = controller;
    if (!state.connected && state.control !== 'Offline') {
      publish({
        busy: true,
        control: 'Connecting',
        message: 'Connecting to the companion…',
      });
    }
    try {
      let response = await request('/api/state', controller).catch(() => null);
      if (controller.signal.aborted || stopped) return;
      if (!response || response.status === 403) {
        const replacement = await reconnectCompanion(controller.signal, environment);
        if (controller.signal.aborted || stopped) return;
        if (replacement) {
          activeSession = rememberCompanionSession(replacement, environment);
          triedRemembering = false;
          bridge = null;
          response = await request('/api/state', controller);
        }
      }
      if (controller.signal.aborted || stopped) return;
      if (response?.status === 403) {
        expired = true;
        forgetCompanionSession(environment);
        throw Error('session');
      }
      if (!response?.ok) throw Error('connection');
      const value: unknown = await response.json();
      const next = readState(value);
      if (controller.signal.aborted || stopped) return;
      if (!triedRemembering && isRecord(value)) {
        rememberCompanionReconnect(value.reconnectKey, activeSession.port, environment);
        triedRemembering = true;
      }
      const changed = !state.connected || next.revision !== bridge?.revision;
      bridge = next;
      publish(
        {
          connected: true,
          control: state.paused ? 'Paused' : leagueControl(next),
          message: state.paused ? 'Sync paused' : next.message,
          prompt: false,
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
          ? 'This session expired. Reconnect to start a new session.'
          : control === 'Update'
            ? 'Update the companion to connect to this website.'
            : control === 'Blocked'
              ? 'Allow local companion access in your browser’s site settings, then reconnect.'
              : 'The companion is unreachable. Reconnect to open it again.';
      publish({
        connected: false,
        control,
        message,
        progress: state.prompt ? message : '',
        quitError: '',
      });
      if (wasConnected && control === 'Offline')
        timer = environment.setTimeout(poll, 3000);
    } finally {
      pollRequest = null;
      if (!stopped && !quitRequest && state.busy) publish({ busy: false });
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
      progress: '',
      quitError: '',
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
        control: paused ? 'Paused' : leagueControl(bridge),
        message: paused
          ? 'Sync paused'
          : (bridge?.message ?? 'Connecting to League…'),
      },
      !paused,
    );
  }

  return {
    async start(alreadyPaired = false) {
      const status = await loopbackPermission(environment.navigator);
      if (stopped) return;
      permission = status;
      permission?.addEventListener('change', permissionChanged);
      if (!pollRequest && !state.connected) {
        if (
          (alreadyPaired || session.restored === 'preview') &&
          permission?.state !== 'denied'
        ) {
          void poll();
        } else {
          permissionChanged();
          if (
            !alreadyPaired &&
            !session.restored &&
            permission?.state !== 'granted'
          ) {
            publish({ prompt: true });
          }
        }
      }
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
      publish({ busy: true, quitError: '' });
      try {
        const response = await request('/api/quit', controller);
        if (!response.ok) throw Error('quit');
        if (stopped) return;
        stopped = true;
        permission?.removeEventListener('change', permissionChanged);
        forgetCompanionSession(environment);
        forgetCompanionReconnect(activeSession.port, environment);
        bridge = null;
        publish({
          connected: false,
          paused: false,
          prompt: false,
          busy: false,
          control: 'Closed',
          message: 'Companion closed',
        });
      } catch {
        if (!stopped) {
          publish({
            busy: false,
            quitError:
              'Could not close the companion. Try again here or use Quit in the app.',
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
