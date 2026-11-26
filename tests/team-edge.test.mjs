import {test} from 'vitest';
import assert from 'node:assert/strict';
import {ROLES,emptyDraft,scoreCandidate} from '../web/src/domain/draft-math.ts';
import {scoreTeamDraft} from '../web/src/domain/team-edge.ts';
import {defaultMultipliers} from '../web/src/domain/draft-weights.ts';
import {samplingRange} from '../web/src/domain/sampling.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);

function fixture(){
 const draft=emptyDraft('jungle'),profiles={};
 ROLES.forEach((role,i)=>{
  if(role!=='jungle')draft.allies[role]=i+1;
  draft.enemies[role]=i+11;
  profiles[role]={[i+1]:{id:i+1,role,wr:.51,ally:{},enemy:{}}};
  for(const [j,other] of ROLES.entries()){
   if(role!==other)profiles[role][i+1].ally[other]={[j+1]:[2,1000,.5]};
   profiles[role][i+1].enemy[other]={[j+11]:[2,1000,.5]};
  }
 });
 return {draft,profiles};
}

test('full team counts ten unique synergies and 25 ally-enemy matchups, adding base strength once per champion',()=>{
 const {draft,profiles}=fixture(),before=structuredClone({draft,profiles});
 const result=scoreTeamDraft(draft,profiles,{ownChampion:2});
 assert.equal(result.alliedCount,5);assert.equal(result.enemyCount,5);
 assert.equal(result.complete,true);assert.equal(result.terms.length,35);
 near(result.synergy,10);near(result.counter,25);near(result.score,35);
 const strength=scoreTeamDraft(draft,profiles,{ownChampion:2,includeStrength:true});
 near(strength.base,5);near(strength.score,40);
 assert.deepEqual({draft,profiles},before);
});

test('a lone preview uses the existing candidate matchup and base formula',()=>{
 const {draft,profiles}=fixture();draft.allies=emptyDraft().allies;
 const options={ownChampion:2,includeStrength:true,multipliers:defaultMultipliers()};
 options.multipliers.enemies.top=2;options.multipliers.enemies.support=.5;
 const total=scoreTeamDraft(draft,profiles,options),candidate=scoreCandidate(profiles.jungle[2],draft,options);
 near(total.score,candidate.score);near(total.counter,candidate.counter);near(total.synergy,0);
});

test('partial drafts omit unknown slots, previews add contributions, and clearing returns to an empty total',()=>{
 const {profiles}=fixture(),draft=emptyDraft();
 assert.equal(scoreTeamDraft(draft,profiles).ready,false);
 draft.allies.top=1;
 assert.equal(scoreTeamDraft(draft,profiles).ready,false);
 const preview=scoreTeamDraft(draft,profiles,{ownChampion:2});
 assert.equal(preview.ready,true);near(preview.synergy,1);near(preview.score,1);
 draft.enemies.top=11;
 const withEnemy=scoreTeamDraft(draft,profiles,{ownChampion:2});
 near(withEnemy.counter,2);near(withEnemy.score,3);
 const actualOnly=scoreTeamDraft(draft,profiles);
 near(actualOnly.synergy,0);near(actualOnly.score,1);
 assert.equal(scoreTeamDraft(emptyDraft(),profiles).ready,false);
});

test('team weights average the two ally role weights and apply enemy role weights to every matchup',()=>{
 const {draft,profiles}=fixture(),multipliers=defaultMultipliers();
 multipliers.allies.top=3;multipliers.enemies.support=0;
 const weighted=scoreTeamDraft(draft,profiles,{ownChampion:2,multipliers});
 near(weighted.synergy,14);near(weighted.counter,20);near(weighted.score,34);
 assert.equal(weighted.ignored,5);
 const bad=defaultMultipliers();bad.allies.top=-1;
 assert.throws(()=>scoreTeamDraft(draft,profiles,{ownChampion:2,multipliers:bad}));
});

test('missing active data makes totals unavailable, while zero weights explicitly ignore missing terms',()=>{
 const {draft,profiles}=fixture();
 delete profiles.top[1].enemy.top[11];
 let total=scoreTeamDraft(draft,profiles,{ownChampion:2});
 assert.equal(total.score,null);assert.equal(total.counter,null);assert.equal(total.synergy,10);
 assert.equal(total.missing.length,1);assert.equal(total.complete,false);
 const multipliers=defaultMultipliers();multipliers.enemies.top=0;
 total=scoreTeamDraft(draft,profiles,{ownChampion:2,multipliers});
 assert.equal(total.complete,true);near(total.score,30);
 delete profiles.top[1].ally.support[5];delete profiles.support[5].ally.top[1];
 total=scoreTeamDraft(draft,profiles,{ownChampion:2,multipliers});
 assert.equal(total.synergy,null);assert.equal(total.score,null);
 multipliers.allies.top=0;multipliers.allies.support=0;
 assert.equal(scoreTeamDraft(draft,profiles,{ownChampion:2,multipliers}).complete,true);
});

test('shared synergy uses a saved reverse direction and averages asymmetric directional estimates',()=>{
 const {profiles}=fixture(),draft=emptyDraft();draft.allies.top=1;
 profiles.top[1].ally.jungle[2]=[6,1000,.5]; // 3 adjusted versus 1 in reverse.
 near(scoreTeamDraft(draft,profiles,{ownChampion:2}).synergy,2);
 delete profiles.jungle[2];
 const reverseOnly=scoreTeamDraft(draft,profiles,{ownChampion:2});
 assert.equal(reverseOnly.complete,true);near(reverseOnly.synergy,3);
 assert.equal(scoreTeamDraft(draft,profiles,{ownChampion:2,includeStrength:true}).score,null);
});

test('the team sample range follows directional averaging, shrinkage, role weights, and fixed base strength',()=>{
 const {profiles}=fixture(),draft=emptyDraft();
 draft.allies.top=1;draft.enemies.top=11;
 const records=[[6,500,.55],[-2,2000,.52],[3,800,.54],[-1,1200,.51]];
 const [forward,reverse,topCounter,jungleCounter]=records;
 profiles.top[1].ally.jungle[2]=forward;
 profiles.jungle[2].ally.top[1]=reverse;
 profiles.top[1].enemy.top[11]=topCounter;
 profiles.jungle[2].enemy.top[11]=jungleCounter;
 const priorGames=400,multipliers={allies:{top:3},enemies:{top:2}};
 const options={ownChampion:2,priorGames,multipliers};
 const ranges=records.map(record=>samplingRange(record).map(bound=>bound*record[1]/(record[1]+priorGames)));
 const estimate=scoreTeamDraft(draft,profiles,options);
 const withBase=scoreTeamDraft(draft,profiles,{...options,includeStrength:true});
 for(const end of [0,1]){
  const synergy=2*(ranges[0][end]+ranges[1][end])/2;
  const counters=2*(ranges[2][end]+ranges[3][end]);
  near(estimate.sampleRange[end],synergy+counters);
  near(withBase.sampleRange[end],withBase.base+synergy+counters);
 }
});

test('the team sample range needs observed rates for each scored direction and skips ignored matchups',()=>{
 const {profiles}=fixture(),draft=emptyDraft();
 draft.allies.top=1;draft.enemies.top=11;
 profiles.top[1].enemy.top[11]=[2,1000];
 profiles.top[1].ally.jungle[2]=[2,1000];
 const options={ownChampion:2,multipliers:{enemies:{top:0}}};
 const unobserved=scoreTeamDraft(draft,profiles,options);
 near(unobserved.score,1);
 assert.equal(unobserved.sampleRange,null);

 delete profiles.top[1].ally.jungle[2];
 const reverse=scoreTeamDraft(draft,profiles,options);
 const range=samplingRange(profiles.jungle[2].ally.top[1]);
 reverse.sampleRange.forEach((bound,end)=>near(bound,range[end]/2));
 assert.equal(scoreTeamDraft(draft,profiles,{...options,ignoredPicks:new Set([1])}).sampleRange,null);
 assert.equal(scoreTeamDraft(emptyDraft(),profiles,{ownChampion:2,includeStrength:true}).sampleRange,null);
});

test('role corrections use profiles in the newly assigned roles and duplicate/banned previews are rejected',()=>{
 const {draft,profiles}=fixture();[draft.allies.top,draft.allies.support]=[draft.allies.support,draft.allies.top];
 const moved=scoreTeamDraft(draft,profiles,{ownChampion:2});
 assert.equal(moved.counter,null);assert.equal(moved.score,null);
 for(const ownChampion of [1,11,-1,2.5])assert.throws(()=>scoreTeamDraft(draft,profiles,{ownChampion}));
 draft.bans=[2];assert.throws(()=>scoreTeamDraft(draft,profiles,{ownChampion:2}));
 assert.throws(()=>scoreTeamDraft(emptyDraft(),profiles,{priorGames:-1}));
});

test('excluded allies and enemies contribute no team terms, including ally base strength',()=>{
 const {draft,profiles}=fixture();
 const ignoredPicks=new Set([1,11]);
 delete profiles.top;
 delete profiles.bottom[4].enemy.top[11];
 const result=scoreTeamDraft(draft,profiles,{ownChampion:2,includeStrength:true,ignoredPicks});
 assert.equal(result.complete,true);
 near(result.counter,16);near(result.synergy,6);near(result.base,4);near(result.score,26);
 assert.equal(result.alliedCount,4);
 assert.equal(result.enemyCount,4);
 assert.ok(result.terms.every(term=>!ignoredPicks.has(term.from.id)&&!ignoredPicks.has(term.to?.id)));
});

test('enemy team edge uses enemy profiles and the role weights of the actual draft slots',()=>{
 const {profiles}=fixture(),draft=emptyDraft('jungle');
 draft.allies.top=1;draft.enemies.top=11;draft.enemies.middle=13;
 profiles.top[11]={
  id:11,role:'top',wr:.53,
  ally:{middle:{13:[4,1000,.52]}},
  enemy:{top:{1:[4,1000,.52]},jungle:{2:[-2,1000,.49]}},
 };
 profiles.middle[13]={
  id:13,role:'middle',wr:.52,
  ally:{top:{11:[6,1000,.53]}},
  enemy:{top:{1:[6,1000,.53]},jungle:{2:[2,1000,.51]}},
 };
 delete profiles.jungle;
 const options={
  side:'enemies',ownChampion:2,includeStrength:true,
  multipliers:{allies:{top:2,jungle:.5},enemies:{top:3}},
 };
 const total=scoreTeamDraft(draft,profiles,options);
 near(total.counter,10);near(total.synergy,5);near(total.base,5);near(total.score,20);
 assert.ok(total.sampleRange[0]<total.score&&total.sampleRange[1]>total.score);
 const excluded=scoreTeamDraft(draft,profiles,{...options,ignoredPicks:new Set([13])});
 near(excluded.score,6.5);
 delete profiles.middle[13].enemy.jungle;
 assert.equal(scoreTeamDraft(draft,profiles,options).score,null);
});
