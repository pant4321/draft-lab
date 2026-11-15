import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCompanionSession,loopbackPermission} from '../dist/companion-session.mjs';
import {connectCompanion} from '../dist/companion.mjs';
const token='a'.repeat(43),live='https://pant4321.github.io/draft-lab/';
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
function fixture(permissionState='prompt'){
 const elements=Object.fromEntries(['companion-bar','companion-status','live-sync','connect-companion','quit-companion'].map(id=>[id,{hidden:false,disabled:false,checked:false}]));
 const requests=[],timers=new Map(),states=[],snapshots=[];let nextTimer=0;
 const permission={state:permissionState,addEventListener(_name,callback){this.change=callback;}};
 const environment={document:{getElementById:id=>elements[id]},navigator:{permissions:{async query({name}){assert.equal(name,'loopback-network');return permission;}}},
  sessionStorage:storage(),setTimeout(callback){timers.set(++nextTimer,callback);return nextTimer;},clearTimeout(id){timers.delete(id);},
  async fetch(url,options){requests.push({url,options});return {ok:true,status:200,json:async()=>({bridgeProtocol:1,revision:1,status:'champ_select',message:'Champion select connected',snapshot:{allies:[{id:516,role:'top'}]}})};}};
 const connection=connectCompanion(value=>states.push(value),value=>snapshots.push(value),{token,origin:'http://127.0.0.1:8766'},environment);
 return {elements,requests,timers,states,snapshots,permission,environment,connection};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('first permission request waits for a click, then syncs directly to authenticated loopback; pause and resume work',async()=>{
 const f=fixture();await settle();assert.equal(f.requests.length,0);
 await f.elements['connect-companion'].onclick();
 assert.equal(f.requests[0].url,'http://127.0.0.1:8766/api/state');
 assert.equal(f.requests[0].options.headers['X-DraftLab-Session'],token);
 assert.equal(f.requests[0].options.credentials,'omit');assert.equal(f.requests[0].options.targetAddressSpace,'loopback');
 assert.equal(f.requests[0].options.referrerPolicy,'no-referrer');assert.equal(f.snapshots.length,1);
 assert.equal(f.elements['connect-companion'].hidden,true);
 f.connection.pause();assert.equal(f.states.at(-1).syncing,false);
 f.connection.resume();assert.equal(f.states.at(-1).syncing,true);assert.equal(f.snapshots.length,2);
});
test('granted access reconnects automatically; repeated clicks never start parallel polling',async()=>{
 const f=fixture('granted');await settle();assert.equal(f.requests.length,1);
 let finish;f.environment.fetch=async()=>new Promise(resolve=>{finish=resolve;});
 const first=f.elements['connect-companion'].onclick();await f.elements['connect-companion'].onclick();
 finish({ok:true,status:200,json:async()=>({bridgeProtocol:1,revision:2,status:'connected'})});await first;
 assert.equal(f.timers.size,1);
});
test('denied or unsupported permissions do not loop requests; unavailable sessions keep manual drafting usable',async()=>{
 assert.equal(await loopbackPermission({permissions:{query(){throw Error('unsupported');}}}),null);
 const f=fixture('denied');await settle();assert.equal(f.requests.length,0);
 assert.match(f.elements['companion-status'].textContent,/site settings/);
 f.environment.fetch=async()=>({ok:false,status:403});
 await f.elements['connect-companion'].onclick();assert.equal(f.states.at(-1).syncing,false);
 assert.match(f.elements['companion-status'].textContent,/expired/);assert.equal(f.timers.size,0);
});
test('quit reports failures honestly and only stops polling after a successful authenticated shutdown',async()=>{
 const f=fixture('granted');await settle();
 f.environment.fetch=async()=>{throw Error('offline');};await f.elements['quit-companion'].onclick();
 assert.match(f.elements['companion-status'].textContent,/Could not close/);assert.equal(f.timers.size,1);
 f.environment.fetch=async(url,options)=>{assert.equal(url,'http://127.0.0.1:8766/api/quit');assert.equal(options.method,'POST');return {ok:true};};
 await f.elements['quit-companion'].onclick();assert.equal(f.timers.size,0);
 assert.equal(f.elements['companion-status'].textContent,'Companion closed');
});
