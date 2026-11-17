import test from 'node:test';
import assert from 'node:assert/strict';
import {contributionBreakdown} from '../dist/draft-breakdown.mjs';

const champion=id=>({name:id===9?'Fiddlesticks':`Champion ${id}`});
const options={champion,portrait:id=>`<img data-champion="${id}" alt="">`};
const pair=(id,side,role,overrides={})=>({id,side,kind:side==='allies'?'ally':'enemy',role,raw:2,games:56404,adjusted:1.9,weighted:1.9,multiplier:1,...overrides});
const row=pairs=>({id:9,wr:.51,base:1,score:3.8,synergy:1.9,counter:1.9,complete:true,pairs});

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
