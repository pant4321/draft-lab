import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyDraft,rankDraft,ROLES} from '../dist/draft-math.mjs';
import {recommendationList,sortPickerChampions,sortRecommendationRows} from '../dist/draft-list.mjs';
import {roleBlindability} from '../dist/blindability.mjs';

const champions=new Map([[1,{id:1,name:'Zed',roles:{jungle:{pickRate:20}}}],
 [2,{id:2,name:'Ahri',roles:{jungle:{pickRate:20},middle:{pickRate:30}}}],
 [3,{id:3,name:'Bard',roles:{jungle:{pickRate:2},middle:{pickRate:50}}}],
 [4,{id:4,name:'Annie',roles:{}}],[5,{id:5,name:'Amumu',roles:{}}]]);
const profiles=Object.fromEntries([...champions.keys()].map(id=>[id,{
 id,role:'jungle',wr:.5+id/100,enemy:{top:{99:[id,1000]}},ally:{}
}]));
const blind={1:{score:90},2:{score:90},3:{score:0},4:{score:null}};

test('empty and bans-only drafts list blind picks with alphabetical ties, unavailable scores last, and no draft edge',()=>{
 const draft=emptyDraft(),before=structuredClone(profiles);
 const list=recommendationList(draft,profiles,blind,champions);
 assert.equal(list.mode,'blindability');
 assert.deepEqual(list.ranked.map(r=>r.id),[2,1,3,5,4]);
 assert.ok(list.ranked.every(r=>r.score===null&&r.counter===null&&r.synergy===null&&r.pairs.length===0));
 assert.deepEqual(recommendationList(draft,profiles,blind,champions,{includeStrength:true}),list);
 draft.bans=[2];
 assert.deepEqual(recommendationList(draft,profiles,blind,champions).ranked.map(r=>r.id),[1,3,5,4]);
 assert.deepEqual(profiles,before);
});

test('revealed picks switch to unchanged draft ranking and clearing returns to blindability',()=>{
 const draft=emptyDraft();draft.enemies.top=99;
 for(const includeStrength of [false,true]){
  const {mode,...result}=recommendationList(draft,profiles,blind,champions,{includeStrength});
  assert.equal(mode,'draft');assert.deepEqual(result,rankDraft(draft,profiles,{includeStrength}));
  const {mode:otherMode,...withoutBlindability}=recommendationList(draft,profiles,{},champions,{includeStrength});
  assert.equal(otherMode,'draft');assert.deepEqual(result,withoutBlindability);
 }
 draft.enemies.top=null;
 assert.equal(recommendationList(draft,profiles,blind,champions).ranked[0].id,2);
});

test('all five real role pools can browse blindability before any picks',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../dist/data/draft/catalog.json',import.meta.url)));
 const champions=new Map(catalog.champions.map(c=>[c.id,c]));
 for(const role of ROLES){
  const {profiles}=JSON.parse(readFileSync(new URL(`../dist/data/draft/${role}.json`,import.meta.url)));
  const scores=roleBlindability(profiles,catalog.champions);
  const list=recommendationList(emptyDraft(role),profiles,scores,champions);
  assert.equal(list.mode,'blindability');assert.equal(list.ranked.length,Object.keys(profiles).length);
  assert.equal(scores[list.ranked[0].id].score,100);
  const values=list.ranked.map(r=>scores[r.id].score??-1);
  assert.ok(values.every((score,i)=>!i||values[i-1]>=score));
 }
});

test('picker order follows the selected role popularity, then names, including unsupported-role picks',()=>{
 assert.deepEqual(sortPickerChampions(champions.values(),'jungle').map(c=>c.id),[2,1,3,5,4]);
 assert.deepEqual(sortPickerChampions(champions.values(),'middle').map(c=>c.id),[3,2,5,4,1]);
 assert.deepEqual([...champions.keys()],[1,2,3,4,5]);
});

test('metric sorting keeps ties stable and unavailable values last in either direction',()=>{
 const rows=[
  {id:1,score:3,sample:1.5},
  {id:2,score:2,sample:null},
  {id:3,score:-1,sample:0},
  {id:4,score:1,sample:1.5}
 ];
 assert.deepEqual(sortRecommendationRows(rows,'sample',1).map(row=>row.id),[3,1,4,2]);
 assert.deepEqual(sortRecommendationRows(rows,'sample',-1).map(row=>row.id),[1,4,3,2]);
 assert.deepEqual(sortRecommendationRows(rows,'score',-1).map(row=>row.id),[1,2,4,3]);
 assert.deepEqual(rows.map(row=>row.id),[1,2,3,4]);
});
