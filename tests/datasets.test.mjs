import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatasetStore} from '../dist/datasets.mjs';
import {ROLES} from '../dist/draft-math.mjs';

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
