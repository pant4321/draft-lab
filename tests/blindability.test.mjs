import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupSpread,estimateBlindSpread,counterpickRisk,estimateCounterSafety,roleBlindability} from '../dist/blindability.mjs';
import {stackMatchups,matchupSpreadGraph} from '../dist/matchup-spread.mjs';
import {ROLES,emptyDraft,rankDraft} from '../dist/draft-math.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const champions=[1,2,3,4,5].map(id=>({id,roles:Object.fromEntries(ROLES.map(r=>[r,{pickRate:20}]))}));
function fixture(id,scale=1,n=10001){
 const pairs=Object.fromEntries([1,2,3,4,5].map((cid,i)=>[cid,[(i-2)*scale,n,.5]]));
 return {id,role:'jungle',wr:.5,enemy:Object.fromEntries(ROLES.map(r=>[r,structuredClone(pairs)])),ally:Object.fromEntries(ROLES.filter(r=>r!=='jungle').map(r=>[r,structuredClone(pairs)]))};
}
test('group variance removes binomial sampling variance with the centering correction',()=>{
 const p=fixture(99),weights=Object.fromEntries([1,2,3,4,5].map(id=>[id,20]));
 const r=groupSpread(p.enemy.top,weights);assert.equal(r.resolved,true);
 near(r.observedVariance,2);near(r.noiseVariance,.2);near(r.trueVariance,1.8);
 const total=estimateBlindSpread(p,champions);assert.equal(total.groups.length,9);near(total.spread,Math.sqrt(1.8));
});
test('lower weighted downside ranks higher, tied values share a percentile',()=>{
 const p={99:fixture(99),98:fixture(98),97:fixture(97,2)};
 const scores=roleBlindability(p,champions);
 assert.equal(scores[99].score,75);assert.equal(scores[98].score,75);assert.equal(scores[97].score,0);
});

test('counter risk sums negative effects multiplied by full-pool pick-rate share',()=>{
 const weights={1:10,2:30,3:20,4:20,5:20};
 const pairs={1:[-4,1000],2:[-2,1000],3:[3,1000],4:[5,1000],5:[0,1000]};
 const risk=counterpickRisk(pairs,weights);
 near(risk.loss,.5); // 10% * 2 pp + 30% * 1 pp after sample shrinkage.
 near(risk.rows.find(r=>r.id===1).weight,.1);near(risk.rows.find(r=>r.id===2).weight,.3);
 pairs[3][0]=300;pairs[4][0]=500;
 near(counterpickRisk(pairs,weights).loss,.5);
 pairs[1][1]=100; // A smaller sample receives a smaller penalty.
 assert.ok(counterpickRisk(pairs,weights).loss<risk.loss);
 const positive=Object.fromEntries(Object.keys(weights).map(id=>[id,[Number(id),1000]]));
 near(counterpickRisk(positive,weights).loss,0);
 assert.throws(()=>counterpickRisk(pairs,weights,{priorGames:-1}));
});

test('rare hard counters contribute less than common mild counters and sub-0.5% roles are included',()=>{
 const weights={1:1,2:20,3:20,4:20,5:39};
 const pairs={1:[-5,1000],2:[-1,1000],3:[0,1000],4:[0,1000],5:[0,1000]};
 const risk=counterpickRisk(pairs,weights,{priorGames:0});
 near(risk.loss,.25);
 const cost=id=>{const r=risk.rows.find(r=>r.id===id);return r.weight*-r.adjusted;};
 near(cost(1),.05);near(cost(2),.2);assert.ok(cost(1)<cost(2));
 const p=fixture(99,0),rareMeta=champions.map(c=>({...c,roles:Object.fromEntries(ROLES.map(r=>[r,{pickRate:c.id===1?.1:24.975}]))}));
 for(const pairs of Object.values(p.enemy))pairs[1][0]=-5;
 const safety=estimateCounterSafety(p,rareMeta,{priorGames:0});
 assert.equal(safety.resolved,true);
 near(safety.counterLoss,5*.001*5);
 assert.ok(safety.counterGroups.every(g=>g.rows.some(r=>r.id===1)));
});

test('positive bonuses, role WR, and ally synergy cannot affect counterpick safety',()=>{
 const original=fixture(99),before=estimateCounterSafety(original,champions);
 const positive=structuredClone(original);
 for(const pairs of Object.values(positive.enemy))for(const pair of Object.values(pairs))if(pair[0]>0)pair[0]*=100;
 for(const pairs of Object.values(positive.ally))for(const pair of Object.values(pairs))pair[0]*=1000;
 positive.wr=.9;
 const changed=estimateCounterSafety(positive,champions);
 near(changed.counterLoss,before.counterLoss);
 delete positive.ally;
 assert.equal(estimateCounterSafety(positive,champions).resolved,true);
 near(estimateCounterSafety(positive,champions).counterLoss,before.counterLoss);
 positive.enemy.top[1][0]=-10;
 const countered=estimateCounterSafety(positive,champions);
 assert.ok(countered.counterLoss>before.counterLoss);
 near(before.counterLoss,before.counterGroups.reduce((sum,g)=>sum+g.loss,0));
});

test('base WR cannot change the safety percentile or break a downside tie',()=>{
 const weak=fixture(99),strong=fixture(98);weak.wr=.48;strong.wr=.55;
 const scores=roleBlindability({99:weak,98:strong,97:fixture(97,2)},champions);
 assert.equal(scores[99].score,75);assert.equal(scores[98].score,75);assert.equal(scores[97].score,0);
});

test('spread graph uses one role’s exact deltas, meta weights and corrected variance',()=>{
 const p=fixture(99),weighted=champions.map((c,i)=>({...c,name:'Champion '+c.id,key:'Test',roles:Object.fromEntries(ROLES.map(r=>[r,{pickRate:(i+1)*10}]))}));
 // Shift one role; the graph must show raw deltas and center its curve at this role's mean.
 for(const pair of Object.values(p.enemy.top))pair[0]+=3;
 const estimate=estimateBlindSpread(p,weighted),group=estimate.groups.find(g=>g.kind==='enemy'&&g.role==='top');
 near(group.rows.reduce((s,r)=>s+r.weight,0),1);
 near(group.mean,11/3);
 near(group.rows.reduce((s,r)=>s+r.weight*(r.delta-group.mean)**2,0),group.observedVariance);
 near(group.trueVariance,group.observedVariance-group.noiseVariance);
 assert.deepEqual(group.rows.map(r=>r.id),[1,2,3,4,5]);
 assert.deepEqual(group.rows.map(r=>r.delta),[1,2,3,4,5]);
 const metadata=new Map([...weighted.map(c=>[c.id,c]),[99,{name:'Example',key:'Example'}]]);
 const graph=matchupSpreadGraph(estimate,metadata,99,'enemy','top');
 assert.equal((graph.match(/data-spread-champion=/g)||[]).length,5);
 assert.match(graph,/data-delta="5"/);assert.match(graph,/Example true spread/);
 assert.match(graph,/spread-cutoff/);assert.match(graph,/spread-curve/);
 assert.doesNotMatch(graph,/NaN|Infinity|blindability z/);
 assert.match(matchupSpreadGraph(estimate,metadata,99,'ally','jungle'),/Not enough common matchup data/);
 const flat=estimateBlindSpread(fixture(99,0),weighted);
 const unresolved=matchupSpreadGraph(flat,metadata,99,'enemy','top');
 assert.match(unresolved,/true spread unresolved/);assert.doesNotMatch(unresolved,/<path class="spread-curve"/);
});

test('portrait stacking preserves exact x positions and prevents overlap or clipping',()=>{
 const rows=Array.from({length:45},(_,i)=>({id:i,delta:(i%9-4)*.2}));
 const before=JSON.stringify(rows),layout=stackMatchups(rows),{points,left,right,bound,size,gap,baseline,top}=layout;
 assert.equal(points.length,rows.length);assert.equal(JSON.stringify(rows),before);
 for(const p of points){
  near(p.cx,left+(p.delta+bound)/(2*bound)*(right-left));
  assert.ok(p.cx-size/2>=left&&p.cx+size/2<=right);
  assert.ok(baseline-size-3-p.level*(size+gap)>=top+40);
  for(const other of points)if(p.id!==other.id&&p.level===other.level)assert.ok(Math.abs(p.cx-other.cx)>=size+gap-1e-9);
 }
});

test('safety scores require enemy coverage, while graph noise and role WR are separate',()=>{
 const missing=fixture(99);delete missing.enemy.top;
 const flat=fixture(98,0);
 const scores=roleBlindability({99:missing,98:flat,97:fixture(97)},champions);
 assert.equal(scores[99].resolved,false);assert.equal(scores[99].score,null);
 assert.equal(scores[98].resolved,true);assert.equal(scores[98].score,100);
 assert.equal(scores[98].spread,null); // A graph with unresolved variance does not erase a valid downside estimate.
 assert.equal(scores[97].score,0);
 assert.equal(roleBlindability({99:missing,97:fixture(97)},champions)[97].score,null);
 const invalid=fixture(96);invalid.wr=NaN;
 assert.equal(estimateCounterSafety(invalid,champions).resolved,true);
 const weights={1:20,2:20,3:20,4:20,5:20,6:100};
 assert.equal(counterpickRisk(fixture(99).enemy.top,weights).resolved,false);
});
test('blindability never changes draft scores, order, or input data',()=>{
 const root=new URL('../dist/data/draft/',import.meta.url);
 const catalog=JSON.parse(readFileSync(new URL('catalog.json',root))).champions;
 const profiles=JSON.parse(readFileSync(new URL('jungle.json',root))).profiles;
 const original=JSON.stringify(profiles),d=emptyDraft();d.allies.top=516;d.allies.middle=103;d.enemies.top=58;d.enemies.jungle=64;d.enemies.support=111;
 const before=rankDraft(d,profiles),b=roleBlindability(profiles,catalog);
 const metadata=new Map(catalog.map(c=>[c.id,c]));
 for(const estimate of Object.values(b))for(const group of estimate.groups){
  assert.ok(group.rows.every(r=>Number.isFinite(r.delta)&&metadata.has(r.id)));
  const graph=matchupSpreadGraph(estimate,metadata,estimate.id,group.kind,group.role);
  assert.equal((graph.match(/data-spread-champion=/g)||[]).length,group.rows.length);
  assert.doesNotMatch(graph,/NaN|Infinity/);
 }
 const after=rankDraft(d,profiles);
 assert.deepEqual(after,before);assert.equal(JSON.stringify(profiles),original);
 d.bans=[before.ranked[0].id];d.enemies.middle=134;
 assert.deepEqual(roleBlindability(profiles,catalog),b);
 for(const value of Object.values(b)){assert.ok(value.score>=0&&value.score<=100);assert.ok(Number.isFinite(value.counterLoss)&&value.counterLoss>=0);}
});
