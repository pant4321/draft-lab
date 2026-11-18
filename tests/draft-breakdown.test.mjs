import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contributionBreakdown,remainingCounterCards,poolBanList} from '../dist/draft-breakdown.mjs';

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
