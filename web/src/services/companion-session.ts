import { isRecord } from '../domain/types';
import { canUseCompanion, isLiveSite } from './site-location';

export type CompanionSessionFields = { token: string; port: number };
export type CompanionSession = CompanionSessionFields & {
  origin: string;
  restored?: 'preview' | 'live';
};

const SESSION = 'draftlab-companion-v1';
const RECONNECT = 'draftlab-companion-reconnect-v1';
const PAIRING_PORTS = [8766, 8767, 8768];
type ReconnectFields = { key: string; port: number };

export function rememberCompanionSession(
  { token, port }: CompanionSessionFields,
  environment = globalThis,
) {
  try {
    environment.sessionStorage.setItem(
      SESSION,
      JSON.stringify({ token, port }),
    );
  } catch {}
  return { token, port, origin: `http://127.0.0.1:${port}` };
}

export function validSession(value: unknown): value is CompanionSessionFields {
  return (
    isRecord(value) && validKey(value.token) && validPort(value.port)
  );
}

function validKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{32,128}$/.test(value);
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= 1 && value <= 65535;
}

function readReconnect(environment: typeof globalThis): ReconnectFields | null {
  try {
    const value: unknown = JSON.parse(environment.localStorage.getItem(RECONNECT) ?? 'null');
    if (isRecord(value) && validKey(value.key) && validPort(value.port)) {
      return { key: value.key, port: value.port };
    }
  } catch {}
  return null;
}

export function rememberCompanionReconnect(key: unknown, port: number, environment = globalThis) {
  if (!validKey(key)) return;
  try {
    environment.localStorage.setItem(RECONNECT, JSON.stringify({ key, port }));
  } catch {}
}

export function forgetCompanionReconnect(port: number, environment = globalThis, key?: string) {
  const saved = readReconnect(environment);
  if (saved?.port !== port || (key !== undefined && key !== saved.key)) return;
  try {
    environment.localStorage.removeItem(RECONNECT);
  } catch {}
}

export async function reconnectCompanion(signal: AbortSignal, environment = globalThis) {
  const saved = readReconnect(environment);
  if (!saved) return null;
  const site = new URL(environment.location.href);
  if (!canUseCompanion(site)) return null;

  const permission = await loopbackPermission(environment.navigator);
  if (signal.aborted || permission?.state === 'denied' ||
      (isLiveSite(site) && permission?.state !== 'granted')) return null;

  try {
    const response = await requestPairing(
      saved.port,
      '/api/reconnect',
      { 'X-DraftLab-Reconnect': saved.key },
      AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      environment,
    );
    if (signal.aborted) return null;
    if (response.status === 403 || response.status === 404) {
      forgetCompanionReconnect(saved.port, environment, saved.key);
    }
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!validSession(value) || value.port !== saved.port) return null;
    return {
      token: value.token,
      port: value.port,
      championBuildsVersion: 'championBuildsVersion' in value ? value.championBuildsVersion : null,
      draftBuilds: 'draftBuilds' in value && value.draftBuilds === true,
    };
  } catch {
    return null;
  }
}

export function prepareCompanionSession(
  environment = globalThis,
): CompanionSession | null {
  const { location, history } = environment,
    url = new URL(location.href);
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (!canUseCompanion(url)) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  let session: CompanionSession | null = null;
  if (params.has('companion')) {
    const rawPort = params.get('port') ?? (local ? url.port : '');
    const value = {
      token: params.get('companion'),
      port: /^\d+$/.test(rawPort) ? Number(rawPort) : 0,
    };
    if (validSession(value)) {
      session = rememberCompanionSession(value, environment);
    } else {
      try {
        environment.sessionStorage.removeItem(SESSION);
      } catch {}
    }
    for (const key of ['companion', 'port']) params.delete(key);
    url.hash = params.toString();
    try {
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  } else {
    try {
      const value = JSON.parse(
        environment.sessionStorage.getItem(SESSION) ?? 'null',
      );
      if (validSession(value)) {
        session = {
          token: value.token,
          port: value.port,
          origin: `http://127.0.0.1:${value.port}`,
          restored: local ? 'preview' : 'live',
        };
      }
    } catch {}
  }
  return session;
}
export function forgetCompanionSession(environment = globalThis) {
  try {
    environment.sessionStorage.removeItem(SESSION);
  } catch {}
}

export function createCompanionOffer() {
  const site = new URL(location.href);
  if (!canUseCompanion(site)) return null;
  const tickets = PAIRING_PORTS.map((port) => ({
    port,
    ticket: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  }));
  const path = tickets.map(({ ticket }) => ticket).join('/');
  const query = new URLSearchParams({ origin: site.origin });
  return { url: `draftedge://connect/${path}?${query}`, tickets };
}

type CompanionOffer = NonNullable<ReturnType<typeof createCompanionOffer>>;

function requestPairing(
  port: number,
  path: '/api/pair' | '/api/reconnect',
  headers: Record<string, string>,
  signal: AbortSignal,
  environment = globalThis,
) {
  const init = {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    targetAddressSpace: 'loopback',
    signal,
    headers,
  } satisfies RequestInit & { targetAddressSpace: string };
  return environment.fetch(`http://127.0.0.1:${port}${path}`, init);
}

export async function waitForCompanion(
  offer: CompanionOffer,
  signal: AbortSignal,
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(50_000)]);
  const permission = await loopbackPermission(navigator);
  // Let the browser handle the native link before asking for loopback access.
  await new Promise((resolve) => setTimeout(resolve, 350));
  while (!deadline.aborted) {
    if (permission?.state === 'denied') return 'blocked';
    const attempt = new AbortController();
    const probe = AbortSignal.any([
      deadline,
      attempt.signal,
      AbortSignal.timeout(4000),
    ]);
    try {
      return await Promise.any(
        offer.tickets.map(async ({ port, ticket }) => {
          const response = await requestPairing(
            port, '/api/pair', { 'X-DraftLab-Pairing': ticket }, probe,
          );
          if (!response.ok) throw Error('Companion is still starting.');
          const value: unknown = await response.json();
          if (!validSession(value) || value.port !== port) {
            throw Error('Invalid companion session.');
          }
          return value;
        }),
      );
    } catch {
      if (!deadline.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      attempt.abort();
    }
  }
  return null;
}
export async function loopbackPermission(navigator: Navigator) {
  try {
    return await navigator.permissions.query({
      name: 'loopback-network' as PermissionName,
    });
  } catch {
    return null;
  }
}
