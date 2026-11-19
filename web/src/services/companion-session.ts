import { isRecord } from '../domain/types';
import { isLiveSite } from './site-location';

type SessionFields = { token: string; port: number };
export type CompanionSession = SessionFields & { origin: string };

const SESSION = 'draftlab-companion-v1';
export function validSession(value: unknown): value is SessionFields {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    /^[\w-]{32,128}$/.test(value.token) &&
    typeof value.port === 'number' &&
    Number.isInteger(value.port) &&
    value.port >= 1 &&
    value.port <= 65535
  );
}
export function prepareCompanionSession(
  environment = globalThis,
): CompanionSession | null {
  const { location, history } = environment,
    url = new URL(location.href);
  const live = isLiveSite(url);
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (!live && !local) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  let session: SessionFields | null = null;
  if (params.has('companion')) {
    const rawPort = params.get('port') ?? (local ? url.port : '');
    const value = {
      token: params.get('companion'),
      port: /^\d+$/.test(rawPort) ? Number(rawPort) : 0,
    };
    if (validSession(value)) {
      session = value;
      try {
        environment.sessionStorage.setItem(SESSION, JSON.stringify(value));
      } catch {}
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
      if (validSession(value)) session = value;
    } catch {}
  }
  return session
    ? { ...session, origin: `http://127.0.0.1:${session.port}` }
    : null;
}
export function forgetCompanionSession(environment = globalThis) {
  try {
    environment.sessionStorage.removeItem(SESSION);
  } catch {}
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
