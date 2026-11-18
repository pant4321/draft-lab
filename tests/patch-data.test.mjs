import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ROLES} from '../dist/draft-math.mjs';

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
