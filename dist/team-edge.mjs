import {ROLES,MAX_ROLE_MULTIPLIER,pairContribution,validateDraft} from './draft-math.mjs';

function weight(multipliers,side,role){
 const value=multipliers?.[side]?.[role]??1;
 if(!Number.isFinite(value)||value<0||value>MAX_ROLE_MULTIPLIER)throw Error('Invalid team role multiplier.');
 return value;
}

// A team has one term per unordered ally pair and one per ally/enemy matchup.
export function scoreTeamDraft(draft,profiles,{ownChampion=null,priorGames=1000,includeStrength=false,multipliers}={}){
 validateDraft(draft);
 if(!Number.isFinite(priorGames)||priorGames<0)throw Error('Invalid sample adjustment.');
 const allies={...draft.allies};
 if(ownChampion!=null){
  if(!Number.isInteger(ownChampion)||ownChampion<=0||[...Object.values(allies),...Object.values(draft.enemies),...(draft.bans??[])].includes(ownChampion))throw Error('Invalid own champion for team total.');
  allies[draft.role]=ownChampion;
 }
 const picks=ROLES.filter(role=>allies[role]!=null).map(role=>({role,id:allies[role],profile:profiles[role]?.[allies[role]]}));
 const enemies=ROLES.filter(role=>draft.enemies[role]!=null).map(role=>({role,id:draft.enemies[role]}));
 const terms=[],missing=[];
 let counter=0,synergy=0,base=0,ignored=0;
 function add(kind,from,to,effect,multiplier){
  const term={kind,from:{role:from.role,id:from.id},to:to?{role:to.role,id:to.id}:null,multiplier,adjusted:effect,weighted:multiplier===0?0:effect==null?null:effect*multiplier};
  terms.push(term);
  if(multiplier===0)ignored++;
  else if(term.weighted==null)missing.push(term);
  else if(kind==='counter')counter+=term.weighted;
  else if(kind==='synergy')synergy+=term.weighted;
  else base+=term.weighted;
 }
 for(let i=0;i<picks.length;i++){
  const a=picks[i];
  for(let j=i+1;j<picks.length;j++){
   const b=picks[j];
   const forward=pairContribution(a.profile?.ally?.[b.role]?.[b.id],priorGames);
   const reverse=pairContribution(b.profile?.ally?.[a.role]?.[a.id],priorGames);
   // Shared synergy can also be read from the supported teammate's reverse record.
   const available=[forward,reverse].filter(Boolean);
   const effect=available.length?available.reduce((sum,pair)=>sum+pair.adjusted,0)/available.length:null;
   add('synergy',a,b,effect,(weight(multipliers,'allies',a.role)+weight(multipliers,'allies',b.role))/2);
  }
  for(const enemy of enemies){
   const effect=pairContribution(a.profile?.enemy?.[enemy.role]?.[enemy.id],priorGames);
   add('counter',a,enemy,effect?.adjusted??null,weight(multipliers,'enemies',enemy.role));
  }
  if(includeStrength){
   const wr=a.profile?.wr;
   add('base',a,null,Number.isFinite(wr)&&wr>=0&&wr<=1?100*(wr-.5):null,1);
  }
 }
 const complete=missing.length===0;
 return {counter:missing.some(t=>t.kind==='counter')?null:counter,
  synergy:missing.some(t=>t.kind==='synergy')?null:synergy,
  base:missing.some(t=>t.kind==='base')?null:base,
  score:complete?counter+synergy+base:null,complete,missing,terms,ignored,
  alliedCount:picks.length,enemyCount:enemies.length,
  ready:picks.length>0&&terms.length>0,ownChampion};
}
