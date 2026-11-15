import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ROLES} from '../dist/draft-math.mjs';

const root=new URL('../dist/data/',import.meta.url),read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);

test('original rolling 30-day dataset remains byte-for-byte unchanged',()=>{
 const original=JSON.parse(readFileSync(new URL('fixtures/original-30d-hashes.json',import.meta.url),'utf8'));
 for(const [file,expected] of Object.entries(original.files)){
  const content=readFileSync(new URL('../'+original.directory+'/'+file,import.meta.url));
  assert.equal(createHash('sha256').update(content).digest('hex'),expected,file);
 }
});

test('combined dataset uses only distinct patch snapshots and every saved file verifies its checksum',()=>{
 const index=read('datasets.json'),active=read('draft/catalog.json');
 assert.equal(index.default,'combined');assert.ok(index.datasets.some(d=>d.kind==='historical'));
 assert.deepEqual(active.patches.slice(0,6),['16.17','16.18','16.19','16.20','16.21','16.22']);
 assert.equal(new Set(active.patches).size,active.patches.length);
 for(const patch of active.patches){
  const base='patches/'+patch+'/',manifest=read(base+'snapshot.json'),catalog=read(base+'catalog.json');
  assert.equal(manifest.patch,patch);assert.equal(catalog.patch,patch);assert.equal(catalog.errors.length,0);
  for(const [file,expected] of Object.entries(manifest.files)){
   assert.equal(createHash('sha256').update(readFileSync(new URL(base+file,root))).digest('hex'),expected);
  }
  for(const role of ROLES)for(const profile of Object.values(read(base+role+'.json').profiles)){
   assert.equal(profile.patch,patch);assert.equal(profile.role,role);assert.ok(profile.games>0);
   for(const source of profile.sources)assert.equal(new URL(source.url).searchParams.get('patch'),patch);
  }
 }
 for(const entry of index.datasets)for(const [file,expected] of Object.entries(entry.files)){
  const path=entry.base.slice('data/'.length)+'/'+file;
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),expected);
 }
});

test('real combined candidate rates and matchup samples agree with independent patch-weighted calculations',()=>{
 const active=read('draft/catalog.json');
 const snapshots=active.patches.map(patch=>({patch,catalog:read('patches/'+patch+'/catalog.json'),
  profiles:Object.fromEntries(ROLES.map(role=>[role,read('patches/'+patch+'/'+role+'.json').profiles]))}));
 for(const role of ROLES){
  const profiles=read('draft/'+role+'.json').profiles;
  for(const profile of Object.values(profiles)){
   const parts=snapshots.map(snapshot=>snapshot.profiles[role][profile.id]).filter(Boolean);
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
