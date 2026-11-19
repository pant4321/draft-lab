import {test} from 'vitest';
import assert from 'node:assert/strict';
import {ROLES,emptyDraft,rankDraft,scoreCandidate} from '../web/src/domain/draft-math.ts';
import {recommendationList} from '../web/src/domain/draft-list.ts';
import {defaultMultipliers,cleanMultipliers,loadMultipliers,saveMultipliers,customMultipliers,WEIGHTS_STORAGE} from '../web/src/domain/draft-weights.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);
const profile=(id,enemy={},ally={},wr=.5)=>({id,role:'jungle',enemy,ally,wr});
test('role multipliers weight each sample-adjusted synergy/counter term independently, preserving signs and optional base WR',()=>{
 const draft=emptyDraft();draft.allies.top=1;draft.allies.middle=2;draft.enemies.top=3;draft.enemies.jungle=4;draft.enemies.support=5;
 const p=profile(10,{top:{3:[2,1000]},jungle:{4:[4,1000]},support:{5:[-1,1000]}},{top:{1:[3,1000]},middle:{2:[-2,1000]}},.53);
 const before=structuredClone({draft,p}),multipliers=defaultMultipliers();
 multipliers.allies.top=2;multipliers.allies.middle=.5;multipliers.enemies.top=.25;multipliers.enemies.jungle=0;multipliers.enemies.support=3;
 const result=scoreCandidate(p,draft,{multipliers,includeStrength:true});
 near(result.counter,-1.25);near(result.synergy,2.5);near(result.fit,1.25);near(result.base,3);near(result.score,4.25);
 for(const pair of result.pairs)near(pair.weighted,pair.adjusted*pair.multiplier);
 assert.deepEqual({draft,p},before);
 for(const value of [-1,6,Infinity,NaN,'2']){
  const invalid=defaultMultipliers();invalid.enemies.top=value;assert.throws(()=>scoreCandidate(p,draft,{multipliers:invalid}));
 }
});
test('defaults reproduce existing scores and ordering; changing a position changes ranking and follows the assigned role',()=>{
 const draft=emptyDraft();draft.enemies.top=1;draft.enemies.jungle=2;
 const profiles={10:profile(10,{top:{1:[4,1000]},jungle:{2:[-1,1000],1:[3,1000]}}),11:profile(11,{top:{1:[1,1000]},jungle:{2:[2,1000],1:[1,1000]}})};
 const before=rankDraft(draft,profiles),multipliers=defaultMultipliers();
 assert.deepEqual(rankDraft(draft,profiles,{multipliers}),before);assert.equal(before.ranked[0].id,10);
 multipliers.enemies.top=0;multipliers.enemies.jungle=2;
 assert.equal(rankDraft(draft,profiles,{multipliers}).ranked[0].id,11);
 draft.enemies.jungle=null;assert.equal(scoreCandidate(profiles[10],draft,{multipliers}).score,0);
 draft.enemies.top=null;draft.enemies.jungle=1;
 assert.equal(scoreCandidate(profiles[10],draft,{multipliers}).score,3);
});
test('zero explicitly ignores a slot, including missing data, while positive weights still require coverage and bans still exclude',()=>{
 const draft=emptyDraft();draft.enemies.top=1;
 const profiles={10:profile(10),11:profile(11,{top:{1:[2,10]}})},multipliers=defaultMultipliers();
 assert.equal(rankDraft(draft,profiles).ranked.length,1);
 multipliers.enemies.top=0;
 const result=rankDraft(draft,profiles,{multipliers});assert.equal(result.ignored,1);assert.equal(result.ranked.length,2);
 assert.equal(result.ranked[0].pairs[0].weighted,0);assert.equal(result.ranked[0].known,0);assert.equal(result.ranked[0].smallSample,false);
 assert.equal(result.ranked[1].smallSample,false);
 draft.bans=[10];assert.deepEqual(rankDraft(draft,profiles,{multipliers}).ranked.map(row=>row.id),[11]);
 multipliers.enemies.top=.1;draft.bans=[];assert.deepEqual(rankDraft(draft,profiles,{multipliers}).insufficient.map(row=>row.id),[10]);
});
test('multipliers cannot change the blindability list or source matchup data',()=>{
 const draft=emptyDraft(),profiles={10:profile(10),11:profile(11)},champions=new Map([[10,{name:'A'}],[11,{name:'B'}]]),blind={10:{score:20},11:{score:90}};
 const before=structuredClone(profiles),baseline=recommendationList(draft,profiles,blind,champions);
 const multipliers=defaultMultipliers();for(const side of ['allies','enemies'])for(const role of ROLES)multipliers[side][role]=0;
 assert.deepEqual(recommendationList(draft,profiles,blind,champions,{multipliers}),baseline);
 assert.deepEqual(profiles,before);assert.equal(blind[11].score,90);
});
test('settings persist independently, validate malformed values per field, and reset without touching the draft or pools',()=>{
 const values=new Map([['draftlab-draft-v1','keep draft'],['draftlab-pools-v1','keep pools']]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const weights=defaultMultipliers();assert.equal(customMultipliers(weights),false);weights.allies.top=2;weights.enemies.support=0;
 assert.equal(saveMultipliers(storage,weights),true);assert.deepEqual(loadMultipliers(storage),weights);assert.equal(customMultipliers(weights),true);
 saveMultipliers(storage,defaultMultipliers());assert.deepEqual(loadMultipliers(storage),defaultMultipliers());
 assert.equal(values.get('draftlab-draft-v1'),'keep draft');assert.equal(values.get('draftlab-pools-v1'),'keep pools');
 assert.deepEqual(cleanMultipliers({allies:{top:'2',middle:NaN,bottom:-1,support:0},enemies:{top:6,jungle:Infinity,middle:.5}}),{...defaultMultipliers(),allies:{...defaultMultipliers().allies,support:0},enemies:{...defaultMultipliers().enemies,middle:.5}});
 storage.setItem(WEIGHTS_STORAGE,'broken');assert.deepEqual(loadMultipliers(storage),defaultMultipliers());
 assert.deepEqual(loadMultipliers({getItem(){throw Error('blocked');}}),defaultMultipliers());
 assert.equal(saveMultipliers({setItem(){throw Error('blocked');}},weights),false);
 const separate=defaultMultipliers();separate.allies.top=3;assert.equal(separate.enemies.top,1);assert.equal(defaultMultipliers().allies.top,1);
});
