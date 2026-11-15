import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDraft,rankDraft,scoreCandidate,pairContribution,validateDraft} from '../dist/draft-math.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);
function profile(id,enemy={},ally={},wr=.5){return {id,role:'jungle',wr,enemy,ally};}
test('JG third pick uses both allies and all three revealed enemy roles',()=>{
 const d=emptyDraft();d.allies.top=1;d.allies.middle=2;d.enemies.top=3;d.enemies.jungle=4;d.enemies.support=5;
 const p=profile(10,{top:{3:[2,1000]},jungle:{4:[4,1000]},support:{5:[-1,1000]}},{top:{1:[3,1000]},middle:{2:[-2,1000]}});
 const s=scoreCandidate(p,d);assert.equal(s.pairs.length,5);near(s.counter,2.5);near(s.synergy,.5);near(s.score,3);assert.equal(s.complete,true);
});
test('cross-role enemy and teammate picks independently change the winner',()=>{
 const d=emptyDraft();d.enemies.jungle=3;
 const ps={10:profile(10,{jungle:{3:[2,1000]},support:{4:[-8,1000]}},{middle:{5:[10,1000]}}),11:profile(11,{jungle:{3:[1,1000]},support:{4:[1,1000]}},{middle:{5:[0,1000]}})};
 assert.equal(rankDraft(d,ps).ranked[0].id,10);
 d.enemies.support=4;assert.equal(rankDraft(d,ps).ranked[0].id,11);
 d.allies.middle=5;assert.equal(rankDraft(d,ps).ranked[0].id,10);
});
test('picked and banned champions are excluded; missing effects are not neutral evidence',()=>{
 const d=emptyDraft();d.enemies.top=10;d.bans=[11];
 const ps={10:profile(10),11:profile(11),12:profile(12),13:profile(13,{top:{10:[-1,5000]}})};
 const r=rankDraft(d,ps);assert.deepEqual(r.ranked.map(x=>x.id),[13]);assert.deepEqual(r.insufficient.map(x=>x.id),[12]);
});
test('blank draft does not invent a ranking; duplicate and occupied own role drafts are rejected',()=>{
 const d=emptyDraft();assert.equal(rankDraft(d,{10:profile(10)}).ready,false);
 d.allies.top=3;d.enemies.top=3;assert.throws(()=>validateDraft(d));d.enemies.top=null;d.allies.jungle=4;assert.throws(()=>validateDraft(d));
});
test('sample adjustment limits noisy extremes and strength is optional',()=>{
 assert.ok(pairContribution([20,10]).adjusted<pairContribution([1,10000]).adjusted);
 assert.equal(pairContribution([4,0]),null);near(pairContribution([2,1000]).adjusted,1);
 const d=emptyDraft();d.enemies.top=1;
 const p=profile(10,{top:{1:[2,1000]}},{},.53);
 near(scoreCandidate(p,d).score,1);near(scoreCandidate(p,d,{includeStrength:true}).score,4);
});
