import {ROLES,pairContribution} from './draft-math.mjs';

// Informational only. These helpers do not change draft rankings.
export function groupSpread(pairs,weights,{minGames=100,minCoverage=.8}={}) {
 let availableWeight=0,coveredWeight=0;
 const rows=[];
 for(const [id,weight] of Object.entries(weights)){
  if(!Number.isFinite(weight)||weight<=0)continue;
  availableWeight+=weight;
  const p=pairs?.[id];
  if(!p||!Number.isFinite(p[0])||!Number.isInteger(p[1])||p[1]<minGames||!Number.isFinite(p[2])||p[2]<0||p[2]>1)continue;
  coveredWeight+=weight;rows.push({id:Number(id),delta:p[0],n:p[1],p:p[2],weight});
 }
 const coverage=availableWeight>0?coveredWeight/availableWeight:0;
 if(rows.length<5||coverage<minCoverage)return {resolved:false,coverage,count:rows.length};
 const mean=rows.reduce((sum,r)=>sum+r.weight/coveredWeight*r.delta,0);
 const observedVariance=rows.reduce((sum,r)=>sum+r.weight/coveredWeight*(r.delta-mean)**2,0);
 const noiseVariance=rows.reduce((sum,r)=>{
  const w=r.weight/coveredWeight;
  return sum+w*(1-w)*10000*r.p*(1-r.p)/(r.n-1);
 },0);
 return {resolved:true,coverage,count:rows.length,mean,rows:rows.map(r=>({...r,weight:r.weight/coveredWeight})),observedVariance,noiseVariance,trueVariance:observedVariance-noiseVariance};
}
export function estimateBlindSpread(profile,champions,{floor=.5,minGames=100,minCoverage=.8}={}) {
 const groups=[];
 for(const kind of ['enemy','ally'])for(const role of ROLES){
  if(kind==='ally'&&role===profile.role)continue;
  const weights={};
  for(const c of champions){
   if(c.id===profile.id)continue;
   const weight=c.roles[role]?.pickRate??0;
   if(weight>=floor)weights[c.id]=weight;
  }
  groups.push({kind,role,...groupSpread(profile[kind]?.[role],weights,{minGames,minCoverage})});
 }
 const ready=groups.every(g=>g.resolved);
 const variance=ready?groups.reduce((sum,g)=>sum+g.trueVariance,0)/groups.length:null;
 return {id:profile.id,groups,resolved:ready&&variance>0,spread:ready&&variance>0?Math.sqrt(variance):null,
  reason:!ready?'Not enough common matchup data across all roles.':variance<=0?'Sampling noise is too large to resolve consistency.':null};
}
export function counterpickRisk(pairs,weights,{minGames=100,minCoverage=.8,priorGames=1000}={}) {
 if(!Number.isFinite(priorGames)||priorGames<0)throw Error('Invalid sample adjustment.');
 let availableWeight=0,coveredWeight=0;
 const rows=[];
 for(const [id,weight] of Object.entries(weights)){
  if(!Number.isFinite(weight)||weight<=0)continue;
  availableWeight+=weight;
  const pair=pairContribution(pairs?.[id],priorGames);
  if(!pair||pair.games<minGames)continue;
  coveredWeight+=weight;rows.push({id:Number(id),weight,...pair});
 }
 const coverage=availableWeight>0?coveredWeight/availableWeight:0;
 if(rows.length<5||coverage<minCoverage)return {resolved:false,loss:null,coverage,count:rows.length,rows:[]};
 const normalized=rows.map(r=>({...r,weight:r.weight/coveredWeight}));
 const loss=normalized.reduce((sum,r)=>sum+r.weight*Math.max(0,-r.adjusted),0);
 return {resolved:true,loss,coverage,count:rows.length,rows:normalized};
}

export function remainingCounters(profile,champions,draft,{ownChampion=null}={}) {
 const openRoles=ROLES.filter(role=>draft.enemies[role]==null);
 if(!openRoles.length)return null;
 const taken=new Set([profile.id,ownChampion,...Object.values(draft.allies),...Object.values(draft.enemies),...(draft.bans??[])]);
 const threats=new Map();
 for(const champion of champions){
  if(taken.has(champion.id))continue;
  for(const role of openRoles){
   const pickShare=champion.roles[role]?.pickRate;
   if(!Number.isFinite(pickShare)||pickShare<.5)continue;
   const pair=pairContribution(profile.enemy?.[role]?.[champion.id]);
   if(!pair||pair.games<5000||pair.adjusted>=0)continue;
   const downside=-pair.adjusted;
   const severityBoost=Math.exp(.4*Math.min(downside,4));
   const risk=pickShare/100*downside*severityBoost;
   if(risk>(threats.get(champion.id)?.risk??0)){
    threats.set(champion.id,{id:champion.id,role,pickShare,risk,...pair});
   }
  }
 }
 return [...threats.values()].sort((a,b)=>b.risk-a.risk||a.id-b.id).slice(0,3);
}

export function estimateCounterSafety(profile,champions,options={}) {
 const {floor=0}=options;
 // The graphs retain their common-champion filter. Safety includes rare recorded roles too.
 const visual=estimateBlindSpread(profile,champions,{...options,floor:.5});
 const counterGroups=ROLES.map(role=>{
  const weights={};
  for(const c of champions){
   const weight=c.roles[role]?.pickRate??0;
   if(c.id!==profile.id&&weight>0&&weight>=floor)weights[c.id]=weight;
  }
  return {role,...counterpickRisk(profile.enemy?.[role],weights,options)};
 });
 const resolved=counterGroups.every(g=>g.resolved);
 const counterLoss=resolved?counterGroups.reduce((sum,g)=>sum+g.loss,0):null;
 return {...visual,resolved,wr:profile.wr,counterGroups,counterLoss,
  reason:!resolved?'Not enough enemy matchup data across all five roles.':null};
}

export function roleBlindability(profiles,champions,options={}) {
 const values=Object.values(profiles).map(p=>estimateCounterSafety(p,champions,options));
 const resolved=values.filter(v=>v.resolved);
 return Object.fromEntries(values.map(v=>{
  let score=null;
  if(v.resolved&&resolved.length>=2){
   let worse=0,ties=0;
   for(const other of resolved){if(other.id===v.id)continue;const difference=other.counterLoss-v.counterLoss;if(difference>1e-9)worse++;else if(Math.abs(difference)<=1e-9)ties++;}
   score=Math.round(100*(worse+.5*ties)/(resolved.length-1));
  }
  return [v.id,{...v,score,comparedWith:resolved.length}];
 }));
}
