import {test} from 'vitest';
import assert from 'node:assert/strict';
import {prepareCompanionSession,loopbackPermission} from '../web/src/services/companion-session.ts';
import {createCompanionClient} from '../web/src/services/companion.ts';
const token='a'.repeat(43),live='https://draftedge.website/';
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function page(href=live){
 const environment={location:{href},sessionStorage:storage(),history:{replaceState(_state,_title,url){environment.location.href=new URL(url,environment.location.href).href;}}};
 return environment;
}
test('companion launch uses only loopback, removes the token before other scripts, and survives reload in this tab',()=>{
 const environment=page(live+'#companion='+token+'&port=8766');
 const session=prepareCompanionSession(environment);
 assert.deepEqual(session,{token,port:8766,origin:'http://127.0.0.1:8766'});
 assert.equal(environment.location.href,live);
 assert.deepEqual(prepareCompanionSession(environment),session);
 assert.deepEqual(prepareCompanionSession(page('https://pant4321.github.io/draft-lab/#companion='+token+'&port=8766')),session);
 assert.equal(prepareCompanionSession(page()),null);
 assert.equal(prepareCompanionSession(page('https://evil.example/#companion='+token+'&port=8766')),null);
 assert.equal(prepareCompanionSession(page(live+'other/#companion='+token+'&port=8766')),null);
 for(const port of ['0','65536','-1','8766.evil.example','8766/path','1e3']){
  assert.equal(prepareCompanionSession(page(live+'#companion='+token+'&port='+port)),null);
 }
 assert.equal(prepareCompanionSession(page(live+'#companion=bad&port=8766')),null);
});
test('invalid launch cannot reuse a previous token; session storage failure still permits the current launch',()=>{
 const environment=page(live+'#companion='+token+'&port=8766');prepareCompanionSession(environment);
 environment.location.href=live+'#companion=bad&port=8766';assert.equal(prepareCompanionSession(environment),null);
 environment.location.href=live;assert.equal(prepareCompanionSession(environment),null);
 const blocked=page(live+'#companion='+token+'&port=8767');
 Object.defineProperty(blocked,'sessionStorage',{get(){throw Error('blocked');}});
 assert.equal(prepareCompanionSession(blocked).port,8767);assert.equal(blocked.location.href,live);
});

function fixture(permissionState = 'prompt') {
 const requests = [], timers = new Map(), states = [], snapshots = [];
 let nextTimer = 0;
 const permission = {
  state: permissionState,
  addEventListener(_name, callback) { this.change = callback; },
  removeEventListener(_name, callback) { if (this.change === callback) this.change = null; },
 };
 const response = (revision = 1) => ({ ok: true, status: 200, json: async () => ({
  bridgeProtocol: 1, revision, status: 'champ_select', message: 'Champion select connected',
  snapshot: { sessionId: 'fake-session', allies: [{ id: 516, role: 'top', identity: 'discard' }],
    playerIdentity: 'discard', enemies: [], bans: [] },
 }) });
 const environment = {
  navigator: { permissions: { async query({ name }) { assert.equal(name, 'loopback-network'); return permission; } } },
  sessionStorage: storage(),
  setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
  clearTimeout(id) { timers.delete(id); },
  async fetch(url, options) { requests.push({ url, options }); return response(); },
 };
 const client = createCompanionClient({ token, port: 8766, origin: 'http://127.0.0.1:8766' }, (state, snapshot) => {
  states.push(state);
  if (snapshot) snapshots.push(snapshot);
 }, environment);
 return { requests, timers, states, snapshots, permission, environment, client, response,
  latest: () => states.at(-1) };
}

test('permission waits for a click; authenticated loopback imports only draft fields and can pause and resume', async () => {
 const f = fixture();
 await f.client.start();
 assert.equal(f.latest().prompt, true);
 f.client.open();
 assert.equal(f.requests.length, 0);
 await f.client.connect();
 const [request] = f.requests;
 assert.equal(request.url, 'http://127.0.0.1:8766/api/state');
 assert.equal(request.options.headers['X-DraftLab-Session'], token);
 assert.equal(request.options.credentials, 'omit');
 assert.equal(request.options.targetAddressSpace, 'loopback');
 assert.equal(request.options.referrerPolicy, 'no-referrer');
 assert.deepEqual(f.snapshots, [{ sessionId: 'fake-session', playerRole: null, playerChampion: null,
  allies: [{ id: 516, role: 'top' }], enemies: [], bans: [] }]);
 assert.equal(f.latest().control, 'Live');
 assert.equal(f.latest().prompt, false);
 assert.equal(f.latest().showConnect, false);
 f.client.pause();
 assert.equal(f.latest().syncing, false);
 assert.equal(f.latest().control, 'Paused');
 f.client.resume();
 assert.equal(f.latest().syncing, true);
 assert.equal(f.snapshots.length, 2);
 assert.equal(f.requests.length, 1);
});

test('granted access connects automatically, deduplicates polls, and cleans up on disposal', async () => {
 const f = fixture('granted');
 let complete;
 f.environment.fetch = (url, options) => {
  f.requests.push({ url, options });
  return new Promise(resolve => { complete = resolve; });
 };
 await f.client.start();
 f.client.open();
 await f.client.connect();
 assert.equal(f.requests.length, 1);
 assert.equal(f.latest().prompt, false);
 complete(f.response());
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(f.latest().busy, false);
 assert.equal(f.timers.size, 1);
 f.timers.values().next().value.callback();
 assert.equal(f.requests.length, 2);
 f.client.dispose();
 assert.equal(f.requests.at(-1).options.signal.aborted, true);
 assert.equal(f.permission.change, null);
 complete(f.response(2));
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(f.timers.size, 0);
 assert.equal(f.snapshots.length, 1);
});

test('denied or unsupported permission keeps manual drafting available and expired sessions stop retrying', async () => {
 assert.equal(await loopbackPermission({ permissions: { query() { throw Error('unsupported'); } } }), null);
 const f = fixture('denied');
 await f.client.start();
 assert.equal(f.requests.length, 0);
 assert.equal(f.latest().control, 'Blocked');
 assert.match(f.latest().message, /site settings/);
 f.client.dismiss();
 assert.equal(f.latest().prompt, false);
 f.client.open();
 assert.equal(f.latest().prompt, true);
 assert.equal(f.requests.length, 0);
 f.environment.sessionStorage.setItem('draftlab-companion-v1', 'session');
 f.environment.fetch = async () => ({ ok: false, status: 403 });
 await f.client.connect();
 assert.equal(f.latest().control, 'Expired');
 assert.equal(f.latest().syncing, false);
 assert.match(f.latest().progress, /expired/);
 assert.equal(f.timers.size, 0);
 assert.equal(f.environment.sessionStorage.getItem('draftlab-companion-v1'), null);
});

test('a transient failure schedules reconnect and imports again when the bridge returns', async () => {
 const f = fixture();
 await f.client.start();
 await f.client.connect();
 f.environment.fetch = async () => { throw Error('offline'); };
 await f.timers.values().next().value.callback();
 assert.equal(f.latest().control, 'Offline');
 assert.equal(f.latest().syncing, false);
 assert.equal(f.timers.size, 1);
 const retry = f.timers.values().next().value;
 assert.equal(retry.delay, 3000);
 f.environment.fetch = async () => f.response();
 await retry.callback();
 assert.equal(f.latest().control, 'Live');
 assert.equal(f.snapshots.length, 2);
});

test('quit reports failures, then closes only after an authenticated shutdown succeeds', async () => {
 const f = fixture();
 await f.client.start();
 await f.client.connect();
 f.environment.fetch = async () => { throw Error('offline'); };
 await f.client.quit();
 assert.match(f.latest().message, /Could not close/);
 assert.equal(f.timers.size, 1);
 f.environment.fetch = async (url, options) => {
  assert.equal(url, 'http://127.0.0.1:8766/api/quit');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['X-DraftLab-Session'], token);
  return { ok: true };
 };
 await f.client.quit();
 assert.equal(f.timers.size, 0);
 assert.equal(f.latest().control, 'Closed');
 assert.equal(f.latest().showConnect, false);
 assert.equal(f.latest().connected, false);
});
