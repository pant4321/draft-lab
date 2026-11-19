import {rankDraft} from './draft-math.mjs?v=d68b389b73fe';

export function recommendationList(draft,profiles,blindability,champions,options={}) {
 const ranking=rankDraft(draft,profiles,options);
 if(ranking.ready)return {...ranking,mode:'draft'};
 const banned=new Set(draft.bans??[]);
 const ranked=Object.values(profiles).filter(p=>p.role===draft.role&&!banned.has(p.id)).map(p=>({
  id:p.id,role:p.role,wr:p.wr,score:null,counter:null,synergy:null,pairs:[]
 })).sort((a,b)=>(blindability[b.id]?.score??-1)-(blindability[a.id]?.score??-1)
  ||champions.get(a.id).name.localeCompare(champions.get(b.id).name));
 return {...ranking,ready:true,mode:'blindability',ranked};
}

export function sortPickerChampions(champions,role) {
 return [...champions].sort((a,b)=>(b.roles[role]?.pickRate??0)-(a.roles[role]?.pickRate??0)||a.name.localeCompare(b.name));
}

export function sortRecommendationRows(rows,key,direction){
 return [...rows].sort((a,b)=>{
  const left=a[key],right=b[key],hasLeft=Number.isFinite(left),hasRight=Number.isFinite(right);
  if(!hasLeft||!hasRight)return Number(hasRight)-Number(hasLeft);
  return direction*(left-right);
 });
}
