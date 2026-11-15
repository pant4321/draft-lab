import {ROLES} from './draft-math.mjs';

// Informational only. This module never reads a draft or changes rankDraft.
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
export function roleBlindability(profiles,champions,options={}) {
 const values=Object.values(profiles).map(p=>estimateBlindSpread(p,champions,options));
 const resolved=values.filter(v=>v.resolved);
 return Object.fromEntries(values.map(v=>{
  let score=null;
  if(v.resolved&&resolved.length>=2){
   let worse=0,ties=0;
   for(const other of resolved){if(other.id===v.id)continue;const difference=other.spread-v.spread;if(difference>1e-9)worse++;else if(Math.abs(difference)<=1e-9)ties++;}
   score=Math.round(100*(worse+.5*ties)/(resolved.length-1));
  }
  return [v.id,{...v,score,comparedWith:resolved.length}];
 }));
}
