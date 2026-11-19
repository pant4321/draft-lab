import {test} from 'vitest';
import assert from 'node:assert/strict';
import {emptyPools,cleanPools,loadPools,savePools,POOL_STORAGE,poolSections,prioritizePool} from '../web/src/domain/champion-pool.ts';
import {emptyDraft} from '../web/src/domain/draft-math.ts';
import {recommendationList} from '../web/src/domain/draft-list.ts';

const champions=new Map([1,2,3,4].map(id=>[id,{id,name:'Champion '+id}]));
const profiles=Object.fromEntries([1,2,3,4].map(id=>[id,{
 id,role:'jungle',wr:.5,enemy:{top:{99:[id,1000]}},ally:{}
}]));
const blind={1:{score:100},2:{score:80},3:{score:20},4:{score:null}};

test('pool sections preserve the existing order and values within each group',()=>{
 const rows=[{id:1,score:7},{id:2,score:4},{id:3,score:-2},{id:4,score:-5}],before=structuredClone(rows);
 const sections=poolSections(rows,[4,2,2,999]);
 assert.deepEqual(sections.map(s=>s.title),['Your pool','Other champions']);
 assert.deepEqual(sections.map(s=>s.rows.map(r=>r.id)),[[2,4],[1,3]]);
 assert.deepEqual(prioritizePool(rows,[4,2]).map(r=>r.id),[2,4,1,3]);
 assert.deepEqual(rows,before);
 assert.deepEqual(prioritizePool(rows),rows);
 assert.deepEqual(poolSections(rows,[]).map(s=>s.title),[null]);
});

test('pool priority follows blindability or draft edge without changing scores or eligibility',()=>{
 const draft=emptyDraft();
 const blank=recommendationList(draft,profiles,blind,champions);
 assert.deepEqual(prioritizePool(blank.ranked,[4,2]).map(r=>r.id),[2,4,1,3]);
 draft.bans=[2];draft.enemies.top=99;
 const scored=recommendationList(draft,profiles,blind,champions);
 const preferred=prioritizePool(scored.ranked,[2,1]);
 assert.deepEqual(preferred.map(r=>r.id),[1,4,3]);
 for(const row of preferred)assert.deepEqual(row,scored.ranked.find(r=>r.id===row.id));
 assert.equal(preferred.some(r=>r.id===2),false);
 delete profiles[1].enemy.top[99];
 const missing=recommendationList(draft,profiles,blind,champions);
 assert.equal(prioritizePool(missing.ranked,[1,2]).some(r=>r.id===1),false);
 profiles[1].enemy.top[99]=[1,1000];
 draft.bans=[];draft.enemies.top=2;
 assert.equal(prioritizePool(recommendationList(draft,profiles,blind,champions).ranked,[2]).some(r=>r.id===2),false);
});

test('pool settings persist separately by role and clearing one role preserves the others',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const pools=emptyPools();pools.jungle=[1,3];pools.middle=[2];
 assert.equal(savePools(storage,pools),true);
 assert.ok(values.has(POOL_STORAGE));
 assert.deepEqual(loadPools(storage,champions),pools);
 assert.deepEqual(loadPools(storage,champions).jungle,[1,3]);
 const next=loadPools(storage,champions);next.jungle=[];savePools(storage,next);
 assert.deepEqual(loadPools(storage,champions).jungle,[]);
 assert.deepEqual(loadPools(storage,champions).middle,[2]);
});

test('old or corrupted pool settings cannot introduce unknown champions or shared role arrays',()=>{
 assert.deepEqual(cleanPools({jungle:[1,1,999,'2',null,-1],middle:'broken'},champions),{...emptyPools(),jungle:[1]});
 assert.deepEqual(loadPools({getItem:()=>'{bad'},champions),emptyPools());
 assert.deepEqual(loadPools({getItem(){throw Error('Unavailable');}},champions),emptyPools());
 assert.equal(savePools({setItem(){throw Error('Unavailable');}},emptyPools()),false);
 const pools=emptyPools();pools.top.push(1);assert.deepEqual(pools.jungle,[]);
});
