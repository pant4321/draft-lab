import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatasetStore} from '../web/src/services/datasets.ts';
import {ROLES} from '../web/src/domain/draft-math.ts';

function fixture(){
 const bodies=new Map(),calls=[];
 const entries=['combined','emerald-plus','history'].map((id,index)=>{
  const base='data/'+id,files={};
  for(const file of ['catalog.json',...ROLES.map(role=>role+'.json')]){
   const value=file==='catalog.json'?{champions:[{id:index+1,name:id}],profileCounts:{jungle:1}}:{profiles:{[index+1]:{id:index+1,wr:.5+index*.01}}};
   const body=Buffer.from(JSON.stringify(value));files[file]=createHash('sha256').update(body).digest('hex');bodies.set(base+'/'+file,body);
  }
  return {id,label:id,base,kind:id==='history'?'historical':'combined',files};
 });
 const manifest={schemaVersion:1,default:'combined',datasets:entries};
 const fetcher=async url=>{calls.push(url);const body=bodies.get(url.split('?')[0]);return {ok:!!body,arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};};
 return {manifest,bodies,calls,fetcher};
}

test('datasets cache by cohort and checksum when switching between All ranks, Emerald+ and history',async()=>{
 const f=fixture(),store=new DatasetStore(f.manifest,f.fetcher);
 const [first,second]=await Promise.all([store.role('combined','jungle'),store.role('combined','jungle')]);
 assert.deepEqual(first,second);assert.equal(f.calls.length,1);assert.ok(first[1]);
 const emerald=await store.role('emerald-plus','jungle');assert.ok(emerald[2]);assert.equal(emerald[1],undefined);
 const historical=await store.role('history','jungle');assert.ok(historical[3]);
 assert.equal(await store.role('combined','jungle'),first);
 assert.equal(f.calls.length,3);assert.match(f.calls[0],/\?v=[a-f0-9]{64}$/);
 assert.equal((await store.catalog('history')).champions[0].name,'history');
 await assert.rejects(()=>store.role('combined','unknown'));
});

test('old cached or partially updated files are rejected, and failed fetches can retry',async()=>{
 const f=fixture(),original=f.bodies.get('data/combined/jungle.json');
 f.bodies.set('data/combined/jungle.json',f.bodies.get('data/history/jungle.json'));
 const store=new DatasetStore(f.manifest,f.fetcher);
 await assert.rejects(()=>store.role('combined','jungle'),/changed or is incomplete/);
 f.bodies.set('data/combined/jungle.json',original);
 assert.ok((await store.role('combined','jungle'))[1]);assert.equal(f.calls.length,2);
});

test('dataset index rejects duplicate IDs, missing default, and paths outside the project data',()=>{
 for(const base of ['https://example.com/data','/data/combined','data/../secret','data/./combined']){
  const f=fixture();f.manifest.datasets[0].base=base;assert.throws(()=>new DatasetStore(f.manifest,f.fetcher));
 }
 const f=fixture();f.manifest.datasets.push(f.manifest.datasets[0]);assert.throws(()=>new DatasetStore(f.manifest,f.fetcher));
 const other=fixture();other.manifest.default='missing';assert.throws(()=>new DatasetStore(other.manifest,other.fetcher));
});

test('default browser fetch retains its required global receiver',async()=>{
 const f=fixture(),previous=globalThis.fetch;
 globalThis.fetch=function(url){assert.equal(this,globalThis);return f.fetcher(url);};
 try{assert.ok((await new DatasetStore(f.manifest).role('combined','jungle'))[1]);}
 finally{globalThis.fetch=previous;}
});

test('patch filtering recomputes game-weighted profiles and role shares within each cohort',async()=>{
 const f=fixture();
 function put(base,file,value){
  const body=Buffer.from(JSON.stringify(value));
  f.bodies.set(base+'/'+file,body);
  return createHash('sha256').update(body).digest('hex');
 }
 for(const [index,entry] of f.manifest.datasets.slice(0,2).entries()){
  entry.rank=index===0?'All ranks':'Emerald+';
  entry.patches=['16.16','16.17','16.18'];
  const champions=[{id:1,roles:{jungle:{games:2000,wr:.5}}},{id:2,roles:{jungle:{games:1000,wr:.5}}}];
  entry.files['catalog.json']=put(entry.base,'catalog.json',{rank:entry.rank,champions,profileCounts:{jungle:1}});
  entry.patchInputs=entry.patches.map((patch,offset)=>{
   const base=`data/patch-inputs/${entry.id}/${patch}`;
   const games=2000+offset*2000,wr=.4+.2*offset;
   const first={...champions[0],roles:{jungle:{games,wr}}};
   const profile={games,wr,enemy:{top:{2:[offset===0?-4:2+index,offset===0?100:900,wr]}},ally:{}};
   const files={...entry.files,'catalog.json':put(base,'catalog.json',{
    patch,rank:entry.rank,asOf:`2026-11-0${offset+1}T00:00:00Z`,champions:[first,champions[1]],
   }),'jungle.json':put(base,'jungle.json',{profiles:{1:profile}})};
   return {patch,base,files};
  });
 }
 const store=new DatasetStore(f.manifest,f.fetcher);
 const all=await store.select('combined');
 assert.deepEqual(all.patches,['16.16','16.17','16.18']);
 assert.equal(f.calls.length,1);
 assert.ok((await all.role('jungle'))[1]);
 const selected=await store.select('combined',['16.18','unavailable']);
 assert.deepEqual(selected.patches,['16.16','16.17']);
 assert.equal(selected.catalog.asOf,'2026-11-02T00:00:00Z');
 assert.equal(selected.catalog.champions[0].roles.jungle.pickRate,75);
 const result=(await selected.role('jungle'))[1];
 assert.equal(result.games,6000);
 assert.ok(Math.abs(result.wr-8/15)<1e-12);
 assert.equal(result.enemy.top[2][0],1.4);
 assert.equal(result.enemy.top[2][1],1000);
 assert.ok(Math.abs(result.enemy.top[2][2]-.58)<1e-12);
 assert.deepEqual(result.ally.top,{});
 assert.ok(f.calls.every(url=>!url.includes('/16.18/')));

 const emerald=await store.select('emerald-plus',['16.18']);
 assert.equal((await emerald.role('jungle'))[1].enemy.top[2][0],2.3);
 assert.deepEqual((await store.select('combined',all.patches)).patches,all.patches);

 const patchRole='data/patch-inputs/combined/16.16/jungle.json';
 const original=f.bodies.get(patchRole);
 f.bodies.set(patchRole,Buffer.from('{"profiles":{}}'));
 await assert.rejects(()=>selected.role('jungle'),/changed or is incomplete/);
 f.bodies.set(patchRole,original);
 assert.deepEqual((await selected.role('jungle'))[1],result);
});

test('malformed patch inputs cannot provide data for a different patch',()=>{
 const f=fixture(),entry=f.manifest.datasets[0];
 entry.patches=['16.16'];
 entry.patchInputs=[{base:'data/patches/16.17',patch:'16.17',files:entry.files}];
 assert.throws(()=>new DatasetStore(f.manifest,f.fetcher),/Invalid patch data index/);
});
