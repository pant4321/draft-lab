import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupSpread,estimateBlindSpread,roleBlindability} from '../dist/blindability.mjs';
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
test('lower spread gets higher scores, tied spreads share a percentile',()=>{
 const p={99:fixture(99),98:fixture(98),97:fixture(97,2)};
 const scores=roleBlindability(p,champions);
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

test('missing coverage and noise-dominated estimates are not treated as perfectly blindable',()=>{
 const missing=fixture(99);delete missing.enemy.top;
 const flat=fixture(98,0);
 const scores=roleBlindability({99:missing,98:flat,97:fixture(97)},champions);
 assert.equal(scores[99].resolved,false);assert.equal(scores[99].score,null);
 assert.equal(scores[98].resolved,false);assert.equal(scores[98].score,null);
 assert.equal(scores[97].score,null); // one resolved peer cannot define a percentile
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
 for(const value of Object.values(b)){assert.ok(value.score>=0&&value.score<=100);assert.ok(value.spread>0);}
});
