import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROLES,emptyDraft,scoreCandidate} from '../dist/draft-math.mjs';
import {scoreTeamDraft} from '../dist/team-edge.mjs';
import {defaultMultipliers} from '../dist/draft-weights.mjs';
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

test('role corrections use profiles in the newly assigned roles and duplicate/banned previews are rejected',()=>{
 const {draft,profiles}=fixture();[draft.allies.top,draft.allies.support]=[draft.allies.support,draft.allies.top];
 const moved=scoreTeamDraft(draft,profiles,{ownChampion:2});
 assert.equal(moved.counter,null);assert.equal(moved.score,null);
 for(const ownChampion of [1,11,-1,2.5])assert.throws(()=>scoreTeamDraft(draft,profiles,{ownChampion}));
 draft.bans=[2];assert.throws(()=>scoreTeamDraft(draft,profiles,{ownChampion:2}));
 assert.throws(()=>scoreTeamDraft(emptyDraft(),profiles,{priorGames:-1}));
});

test('the original frozen six-patch cohort reproduces its independently searched 0.5% optimum',()=>{
 const draft=emptyDraft('jungle'),ids={top:126,jungle:76,middle:4,bottom:236,support:350};
 const patches=['16.17','16.18','16.19','16.20','16.21','16.22'];
 const profiles=Object.fromEntries(ROLES.map(role=>{
  const parts=patches.map(patch=>JSON.parse(readFileSync(new URL(`../dist/data/patches/${patch}/${role}.json`,import.meta.url))).profiles[ids[role]]).filter(Boolean);
  const ally=Object.fromEntries(ROLES.filter(other=>other!==role).map(other=>{
   const pairs=parts.map(profile=>profile.ally[other]?.[ids[other]]).filter(Boolean),games=pairs.reduce((sum,pair)=>sum+pair[1],0);
   return [other,{[ids[other]]:[pairs.reduce((sum,pair)=>sum+pair[0]*pair[1],0)/games,games]}];
  }));
  return [role,{[ids[role]]:{id:ids[role],role,wr:.5,ally,enemy:{}}}];
 }));
 for(const role of ROLES)if(role!==draft.role)draft.allies[role]=ids[role];
 const total=scoreTeamDraft(draft,profiles,{ownChampion:ids.jungle});
 assert.equal(total.complete,true);assert.equal(total.terms.length,10);
 near(total.score,18.913989137679888);near(total.counter,0);
});
