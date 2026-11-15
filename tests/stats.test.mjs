import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expected,analyze,wilson,cdf,validate} from '../dist/stats.mjs';
const near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('video odds example, symmetry, and synergy example',()=>{
 near(expected(.509,.455),.5539126614883888);
 near(expected(.52,.52),.5);near(expected(.52,.48)+expected(.48,.52),1);
 near(expected(.52,.52,true),.5399361022364217);
 assert.throws(()=>expected(0,.5));
});
test('rank bracket baseline is preserved when champion strengths are equal',()=>{
 near(expected(.523,.523,false,.523),.523);
 near(expected(.523,.523,true,.523),.523);
 assert.throws(()=>expected(.5,.5,false,1));
});
test('weighted centering correction agrees with exact two-cell calculation',()=>{
 const d={qiyanaWr:.5,rows:[{champion:'a',observedWr:.4,opponentWr:.5,games:101,pickRate:1},{champion:'b',observedWr:.6,opponentWr:.5,games:101,pickRate:3}]};
 const r=analyze(d,{floor:0});near(r.mean,5);near(r.observed**2,75);near(r.noise**2,9);near(r.sigma**2,66);near(r.counted,.25);
});
test('unresolved spread and empty filters do not manufacture tail estimates',()=>{
 const d={qiyanaWr:.5,rows:['a','b'].map(champion=>({champion,observedWr:.5,opponentWr:.5,games:10,pickRate:1}))};
 const r=analyze(d,{minGames:2});assert.equal(r.sigma,0);assert.equal(r.tail,null);assert.ok(r.rawTrueVariance<0);
 assert.equal(analyze(d,{minGames:100}),null);
});
test('Wilson intervals remain finite at endpoints, normal tails match known values',()=>{
 const lo=wilson(0,100),hi=wilson(1,100);near(lo[0],0);near(hi[1],1);assert.ok(lo[1]>.03&&lo[1]<.04);near(cdf(0),.5);near(cdf(-2),.02275013,1e-7);
});
test('frozen data validates, contains reference opponents and yields finite metrics',()=>{
 const d=JSON.parse(readFileSync(new URL('../dist/data/qiyana.json',import.meta.url)));
 validate(d);assert.ok(d.rows.length>50);assert.ok(d.rows.some(r=>r.champion==='Vex'));assert.ok(d.rows.some(r=>r.champion==='Taliyah'));
 for(const weighted of [true,false]){const r=analyze(d,{weighted});assert.ok(r.rows.length>20);assert.ok(Number.isFinite(r.sigma));near(r.rows.reduce((s,r)=>s+r.weight,0),1);assert.ok(r.observed>=r.sigma);}
 const bad=structuredClone(d);bad.rows[0].games=0;assert.throws(()=>validate(bad));
});
test('pick-rate floor uses role shares before opponent filtering',()=>{
 const d=JSON.parse(readFileSync(new URL('../dist/data/qiyana.json',import.meta.url)));
 assert.equal(d.pickRateUnit,'percent_of_listed_role_games');
 const r=analyze(d);assert.equal(r.rows.length,44);
 for(const row of d.rows)near(row.pickRate,100*row.metaGames/d.metaRoleGames);
 const garen=d.rows.find(x=>x.champion==='Garen');
 assert.equal(garen.sourcePickRate,.5);
 assert.ok(garen.pickRate<.5);
 assert.ok(!r.rows.some(x=>x.champion==='Garen'));
 // The floor must not be re-normalized over the already-filtered matchup rows.
 const vex=d.rows.find(x=>x.champion==='Vex');
 const subset={...d,rows:[vex,d.rows.find(x=>x.champion==='Taliyah')]};
 near(analyze(subset).rows.find(x=>x.champion==='Vex').pickRate,vex.pickRate);
});
test('independent matchup calculation agrees with the published source deltas',()=>{
 for(const [file,tolerance] of [['qiyana',.0051],['qiyana-diamond',.061]]){
  const d=JSON.parse(readFileSync(new URL('../dist/data/'+file+'.json',import.meta.url)));
  const r=analyze(d,{floor:0});
  for(const row of r.rows)assert.ok(Math.abs(row.delta-row.publishedDelta2)<tolerance,`${file} ${row.champion}: ${row.delta} vs ${row.publishedDelta2}`);
 }
});
