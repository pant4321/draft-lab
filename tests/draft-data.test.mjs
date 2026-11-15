import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROLES,emptyDraft,rankDraft} from '../dist/draft-math.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../dist/data/draft/'+name+'.json',import.meta.url)));
test('collected profiles cover every champion and contain valid role-specific pair samples',()=>{
 const catalog=read('catalog'),ids=new Set(catalog.champions.map(c=>c.id)),covered=new Set();
 assert.equal(catalog.errors.length,0);assert.equal(ids.size,catalog.champions.length);assert.ok(ids.size>=170);
 let pairCount=0;
 for(const role of ROLES){
  const profiles=read(role).profiles;
  assert.equal(Object.keys(profiles).length,catalog.profileCounts[role]);
  for(const profile of Object.values(profiles)){
   assert.equal(profile.role,role);assert.ok(ids.has(profile.id));covered.add(profile.id);
   assert.ok(profile.games>=1000);assert.ok(profile.wr>0&&profile.wr<1);
   assert.ok(profile.sources.length>=2);assert.equal(profile.sources.length,2*profile.componentPatches.length);
   for(const kind of ['ally','enemy'])for(const [otherRole,rows] of Object.entries(profile[kind])){
    assert.ok(ROLES.includes(otherRole));if(kind==='ally')assert.notEqual(otherRole,role);
    for(const [id,[delta,n,wr]] of Object.entries(rows)){
     assert.ok(ids.has(+id));assert.ok(Number.isFinite(delta)&&Math.abs(delta)<=100);
     assert.ok(Number.isInteger(n)&&n>0);assert.ok(wr>=0&&wr<=1);pairCount++;
    }
   }
  }
 }
 for(const c of catalog.champions)if(Object.values(c.roles).some(meta=>meta.games>=1000))assert.ok(covered.has(c.id));
 assert.ok(pairCount>400000);
});
test('real snapshot can rank a two-ally, three-enemy draft for every role',()=>{
 const ally={top:516,jungle:64,middle:103,bottom:222,support:111};
 const enemy={top:58,jungle:234,middle:134,bottom:145,support:89};
 for(const role of ROLES){
  const d=emptyDraft(role);
  for(const r of ROLES.filter(r=>r!==role).slice(0,2))d.allies[r]=ally[r];
  for(const r of ['top','jungle','support'])d.enemies[r]=enemy[r];
  const ranked=rankDraft(d,read(role).profiles);
  assert.ok(ranked.ranked.length>=20,role);assert.equal(ranked.shown,5);
  for(const row of ranked.ranked){assert.equal(row.pairs.length,5);assert.equal(row.missing,0);assert.ok(Number.isFinite(row.score));}
  for(let i=1;i<ranked.ranked.length;i++)assert.ok(ranked.ranked[i-1].score>=ranked.ranked[i].score);
 }
});
