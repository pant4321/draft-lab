import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ROLES} from '../web/src/domain/draft-math.ts';
import {combinePatchCatalogs,combinePatchRole} from '../web/src/domain/patch-stats.ts';

const root=new URL('../dist/data/',import.meta.url),read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);
const snapshotBase=(active,patch)=>{
 const base=active.components.find(component=>component.patch===patch)?.base;
 assert.match(base,/^data\/(?:emerald-plus\/)?(?:patches\/\d+\.\d+|patch-revisions\/\d+\.\d+\/[\w.-]+)$/);
 return base.slice('data/'.length)+'/';
};

test('original rolling 30-day dataset remains byte-for-byte unchanged',()=>{
 const original=JSON.parse(readFileSync(new URL('fixtures/original-30d-hashes.json',import.meta.url),'utf8'));
 for(const [file,expected] of Object.entries(original.files)){
  const content=readFileSync(new URL('../'+original.directory+'/'+file,import.meta.url));
  assert.equal(createHash('sha256').update(content).digest('hex'),expected,file);
 }
});

test('both cohorts use the same distinct patches and every saved file verifies its checksum',()=>{
 const index=read('datasets.json'),active=read('draft/catalog.json'),emerald=read('emerald-plus/draft/catalog.json');
 assert.equal(index.default,'combined');assert.ok(index.datasets.some(d=>d.kind==='historical'));
 assert.deepEqual(active.patches.slice(0,7),['16.16','16.17','16.18','16.19','16.20','16.21','16.22']);
 assert.equal(new Set(active.patches).size,active.patches.length);
 assert.deepEqual(emerald.patches,active.patches);
 const emeraldEntry=index.datasets.find(d=>d.id==='emerald-plus');
 assert.equal(emeraldEntry.rank,'Emerald+');
 assert.deepEqual(emeraldEntry.patches,active.patches);
 const archives=readdirSync(root,{recursive:true}).map(path=>path.replaceAll('\\','/')).filter(path=>/^(emerald-plus\/)?(patches|patch-revisions)\/.*\/snapshot\.json$/.test(path));
 for(const path of archives){
  const base=path.slice(0,-'snapshot.json'.length),manifest=read(path),catalog=read(base+'catalog.json');
  const isEmerald=path.startsWith('emerald-plus/'),patch=path.split('/')[isEmerald?2:1];
  assert.equal(manifest.patch,patch);assert.equal(catalog.patch,patch);assert.equal(catalog.errors.length,0);
  assert.equal(catalog.rank,isEmerald?'Emerald+':'All ranks');
  for(const [file,expected] of Object.entries(manifest.files)){
   assert.equal(createHash('sha256').update(readFileSync(new URL(base+file,root))).digest('hex'),expected);
  }
 }
 for(const catalog of [active,emerald])for(const patch of catalog.patches){
  const base=snapshotBase(catalog,patch),component=catalog.components.find(value=>value.patch===patch);
  assert.equal(base.startsWith('emerald-plus/'),catalog===emerald);
  assert.equal(createHash('sha256').update(readFileSync(new URL(base+'snapshot.json',root))).digest('hex'),component.snapshotSha256);
 }
 for(const entry of index.datasets)for(const [file,expected] of Object.entries(entry.files)){
  const path=entry.base.slice('data/'.length)+'/'+file;
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),expected);
 }
});

test('the completed historical patch captures remain immutable',()=>{
 for(const [base,fixture] of [['patches/','original-patch-hashes.json'],['emerald-plus/patches/','emerald-patch-hashes.json']]){
  const original=JSON.parse(readFileSync(new URL('fixtures/'+fixture,import.meta.url),'utf8'));
  for(const [patch,expected] of Object.entries(original)){
   assert.equal(createHash('sha256').update(readFileSync(new URL(base+patch+'/snapshot.json',root))).digest('hex'),expected);
  }
 }
});

test('both combined datasets retain the finalized patch captures',()=>{
 const finalized=JSON.parse(readFileSync(new URL('fixtures/final-patch-hashes.json',import.meta.url),'utf8'));
 for(const [base,dataset] of [['draft/','combined'],['emerald-plus/draft/','emerald-plus']]){
  const {components}=read(base+'catalog.json');
  for(const [patch,hashes] of Object.entries(finalized)){
   const component=components.find(value=>value.patch===patch);
   assert.equal(component?.snapshotSha256,hashes[dataset],`${dataset} patch ${patch} must use its final snapshot`);
  }
 }
});

test('browser patch aggregation matches offline eligibility, samples and effects for both cohorts',()=>{
 for(const base of ['draft/','emerald-plus/draft/']){
  const active=read(base+'catalog.json'),role='jungle';
  const sources=active.patches.map(patch=>snapshotBase(active,patch));
  const champions=combinePatchCatalogs(sources.map(source=>read(source+'catalog.json')));
  const browser=combinePatchRole(sources.map(source=>read(source+role+'.json').profiles),champions,role,active.candidateFloorRolePercent);
  const offline=read(base+role+'.json').profiles;
  assert.deepEqual(Object.keys(browser),Object.keys(offline));
  for(const champion of active.champions)for(const [name,meta] of Object.entries(champion.roles)){
   const current=champions.get(champion.id).roles[name];
   assert.equal(current.games,meta.games);
   near(current.wr,meta.wr);near(current.pickRate,meta.pickRate);
  }
  for(const [id,profile] of Object.entries(offline)){
   const current=browser[id];
   assert.equal(current.games,profile.games);near(current.wr,profile.wr);
   for(const [kind,other] of [['enemy','top'],['ally','middle']]){
    for(const [opponent,pair] of Object.entries(profile[kind][other])){
     const found=current[kind][other][opponent];
     assert.equal(found[1],pair[1]);near(found[0],pair[0]);near(found[2],pair[2]);
    }
   }
  }
 }
});

for(const [base,rank] of [['draft/','All ranks'],['emerald-plus/draft/','Emerald+']]){
test(`${rank} candidate rates and pair samples agree with independent patch-weighted calculations`,()=>{
 const active=read(base+'catalog.json');
 for(const role of ROLES){
  const archived=active.patches.map(patch=>read(snapshotBase(active,patch)+role+'.json').profiles);
  const profiles=read(base+role+'.json').profiles;
  for(const profile of Object.values(profiles)){
   const parts=archived.map(snapshot=>snapshot[profile.id]).filter(Boolean);
   const total=parts.reduce((sum,p)=>sum+p.games,0);
   assert.equal(profile.games,total);near(profile.wr,parts.reduce((sum,p)=>sum+p.games*p.wr,0)/total);
   for(const kind of ['enemy','ally']){
    const group=Object.keys(profile[kind])[0],ids=Object.keys(profile[kind][group]).slice(0,4);
    for(const id of ids){
     const pairs=parts.map(p=>p[kind][group]?.[id]).filter(Boolean),n=pairs.reduce((sum,p)=>sum+p[1],0);
     const combined=profile[kind][group][id];
     assert.equal(combined[1],n);near(combined[0],pairs.reduce((sum,p)=>sum+p[0]*p[1],0)/n);
     near(combined[2],pairs.reduce((sum,p)=>sum+p[2]*p[1],0)/n);
    }
   }
  }
  near(active.champions.reduce((sum,c)=>sum+(c.roles[role]?.pickRate??0),0),100);
 }
});
}
