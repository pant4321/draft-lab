import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contributionBreakdown,draftSamplingOffsets,remainingCounterCards,poolBanList,samplingRange} from '../dist/draft-breakdown.mjs';
import {emptyDraft,scoreCandidate} from '../dist/draft-math.mjs';

const champion=id=>({name:id===9?'Fiddlesticks':`Champion ${id}`});
const options={champion,portrait:id=>`<img data-champion="${id}" alt="">`};
const pair=(id,side,role,overrides={})=>({id,side,kind:side==='allies'?'ally':'enemy',role,raw:2,games:56404,adjusted:1.9,weighted:1.9,multiplier:1,...overrides});
const row=pairs=>({id:9,wr:.51,base:1,score:3.8,synergy:1.9,counter:1.9,complete:true,pairs});

test('remaining counters show role pick share and adjusted downside with an explicit empty state',()=>{
 const html=remainingCounterCards([{id:2,role:'jungle',pickShare:3.71,adjusted:-1.758,games:32000}],options);
 assert.match(html,/data-champion="2"/);
 assert.match(html,/Champion 2/);
 assert.match(html,/Jungle · 3\.7% pick share/);
 assert.match(html,/32,000 games">-1\.76 pp/);
 assert.match(remainingCounterCards([],options),/No available common counters found/);
 assert.equal(remainingCounterCards(null,options),'');
});

test('pool ban results are read-only and distinguish an empty pool from no qualifying threats',()=>{
 const reason={
  pickShare:3.7,affected:2,poolSize:3,worst:{id:9,adjusted:-1.76,games:32000},risk:.0523,
  contributions:[
   {id:9,adjusted:-1.76,games:32000,priority:.0519},
   {id:8,adjusted:.24,games:21000,priority:0},
   {id:7,adjusted:-.03,games:6000,priority:.0004}
  ]
 };
 const html=poolBanList([{id:2,role:'jungle',...reason},{id:3,role:'support',...reason}],{...options,hasPool:true});
 assert.match(html,/<ol class="pool-ban-list">/);
 assert.ok(html.indexOf('Champion 2')<html.indexOf('Champion 3'));
 assert.match(html,/Jungle · 3\.7% pick share/);
 assert.match(html,/Hurts 2 of 3 pool picks/);
 assert.match(html,/Hardest on Fiddlesticks/);
 assert.match(html,/32,000 games">-1\.76 pp/);
 assert.match(html,/<details name="pool-ban-matchups" data-pool-ban-id="2">/);
 assert.match(html,/aria-label="Pool matchups against Champion 2"/);
 assert.match(html,/Fiddlesticks<\/th><td[^>]*>-1\.76 pp<\/td><td>0\.052<\/td>/);
 assert.match(html,/Champion 8<\/th><td[^>]*>\+0\.24 pp<\/td><td>0<\/td>/);
 assert.match(html,/Champion 7<\/th><td[^>]*>-0\.03 pp<\/td><td>&lt;0\.001<\/td>/);
 assert.doesNotMatch(html,/<(?:button|input|a)\b/);
 assert.match(poolBanList([],options),/Add champions to <strong>Your pool<\/strong>/);
 assert.match(poolBanList([],{...options,hasPool:true}),/No bans to suggest/);
 const page=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(page,/popovertarget="remaining-counter-method" aria-label="How remaining counters are ranked"/);
 assert.match(page,/how common they are in their role, giving extra weight to tougher matchups/);
 assert.match(page,/sample-adjusted effects\. Minimum 5,000 matchup games and 0\.5% role pick share/);
 const bans=page.match(/<section class="bans">([\s\S]*?)<\/section>/)?.[1];
 assert.match(bans,/id="add-ban"[\s\S]*popovertarget="pool-bans-popover">Suggested bans for your pool<\/button>/);
});

test('contributions keep role order, exact sample sizes, sign, and separate team subtotals',()=>{
 const value=row([pair(3,'enemies','middle',{weighted:-1.9,raw:-2}),pair(2,'allies','support'),pair(1,'allies','top')]);
 const before=structuredClone(value),html=contributionBreakdown(value,options);
 assert.ok(html.indexOf('data-champion="1"')<html.indexOf('data-champion="2"'));
 assert.ok(html.indexOf('With your team')<html.indexOf('Against the enemy'));
 assert.match(html,/Adjusted contribution/);
 assert.match(html,/title="56,404 games" aria-label="56,404 games">56.4k games/);
 assert.match(html,/pair-value negative">-1.90/);
 assert.deepEqual(value,before);
});

test('missing data cannot display a neutral score, while zero-weight slots remain explicitly ignored',()=>{
 const html=contributionBreakdown({...row([pair(1,'allies','top',{raw:null,adjusted:null,games:0,weighted:null,multiplier:2})]),complete:false},options);
 assert.match(html,/pair-unavailable">No data/);
 assert.match(html,/breakdown-total zero">No data/);
 assert.match(html,/Synergy <b class="zero">No data/);
 assert.doesNotMatch(html,/NaN|null|>0\.00</);
 const ignored=contributionBreakdown(row([pair(1,'allies','top',{raw:null,adjusted:null,games:0,weighted:0,multiplier:0})]),options);
 assert.match(ignored,/>Ignored</);
 assert.match(ignored,/No data/);
 assert.match(ignored,/0× role weight/);
 const excluded=contributionBreakdown(row([pair(1,'allies','top',{multiplier:0,weighted:0,ignoredPick:true})]),options);
 assert.match(excluded,/Excluded from calculations/);
 assert.doesNotMatch(excluded,/0× role weight/);
});

test('base strength and custom multipliers retain their separate explanations',()=>{
 const value=row([pair(1,'allies','top',{multiplier:2,weighted:3.8})]);
 assert.doesNotMatch(contributionBreakdown(value,options),/Base strength/);
 const html=contributionBreakdown(value,{...options,includeStrength:true});
 assert.match(html,/Base strength/);
 assert.match(html,/51\.00% overall WR vs 50%/);
 assert.match(html,/\+1\.90 adjusted × 2/);
 assert.match(html,/No enemies revealed/);
});

test('sampling intervals are shifted to the raw delta scale and stay bounded for tiny samples',()=>{
 const [low,high]=samplingRange([2,100,.5]);
 assert.ok(Math.abs(low+7.617)<.002);
 assert.ok(Math.abs(high-11.617)<.002);
 const [tinyLow,tinyHigh]=samplingRange([50,1,1]);
 assert.ok(tinyLow>-50);
 assert.equal(tinyHigh,50);
 assert.equal(samplingRange([2,0,.5]),null);
 assert.equal(samplingRange([2,100]),null);
 assert.equal(samplingRange([10,100,.04]),null);
});

test('the breakdown marks low samples and scales sampling ranges to the weighted contributions',()=>{
 const active=pair(1,'enemies','top',{games:100,multiplier:2,weighted:4/11});
 const ignored=pair(2,'allies','support',{multiplier:0,weighted:0,games:100});
 const profile={enemy:{top:{1:[2,100,.5]}},ally:{support:{2:[2,100,.5]}}};
 const html=contributionBreakdown(row([active,ignored]),{
  ...options,profile
 });
 assert.equal((html.match(/Low sample/g)||[]).length,1);
 assert.match(html,/title="100 games"/);
 const evidence=html.match(/<details class="pair-evidence">([\s\S]+)<\/details>/)?.[1];
 assert.match(evidence,/Contribution sampling ranges/);
 assert.match(evidence,/Against Champion 1 · Top[\s\S]*-1\.38 to \+2\.11 pp/);
 assert.doesNotMatch(evidence,/Champion 2/);
});

test('draft sampling offsets combine weighted matchup bounds for large and small samples',()=>{
 const draft=emptyDraft();draft.enemies.top=1;draft.allies.support=2;
 const profile={id:9,role:'jungle',wr:.55,enemy:{top:{1:[2,100,.55]}},ally:{support:{2:[-1,5000,.52]}}};
 const multipliers={enemies:{top:2},allies:{support:1}};
 const pick=scoreCandidate(profile,draft,{multipliers});
 const result=draftSamplingOffsets(pick,profile);
 const top=samplingRange(profile.enemy.top[1]),support=samplingRange(profile.ally.support[2]);
 const weighted=i=>top[i]*2*100/1100+support[i]*5000/6000;
 assert.ok(Math.abs(result.down-(pick.score-weighted(0)))<1e-12);
 assert.ok(Math.abs(result.up-(weighted(1)-pick.score))<1e-12);
 assert.deepEqual(draftSamplingOffsets(scoreCandidate(profile,draft,{multipliers,includeStrength:true}),profile),result);
 const ignored=scoreCandidate(profile,draft,{multipliers:{enemies:{top:0}}});
 assert.equal(ignored.smallSample,false);
 const large=draftSamplingOffsets(ignored,{ally:profile.ally});
 assert.ok(large.down>0&&large.up>0);
});

test('draft sampling offsets require coverage of every active contribution',()=>{
 const draft=emptyDraft();draft.enemies.top=1;
 const profile={id:9,role:'jungle',wr:.55,enemy:{top:{1:[2,500]}}};
 assert.equal(draftSamplingOffsets(scoreCandidate(profile,draft),profile),null);
 assert.equal(draftSamplingOffsets(scoreCandidate(profile,draft,{multipliers:{enemies:{top:0}}}),profile),null);
 assert.equal(draftSamplingOffsets(scoreCandidate(profile,emptyDraft()),profile),null);
});
