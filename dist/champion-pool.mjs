import {ROLES} from './draft-math.mjs';

export const POOL_STORAGE='draftlab-pools-v1';
export function emptyPools(){return Object.fromEntries(ROLES.map(role=>[role,[]]));}
export function cleanPools(value,champions){
 return Object.fromEntries(ROLES.map(role=>[role,[...new Set((Array.isArray(value?.[role])?value[role]:[])
  .filter(id=>Number.isInteger(id)&&champions.has(id)))]]));
}
export function loadPools(storage,champions){
 try{return cleanPools(JSON.parse(storage.getItem(POOL_STORAGE)),champions);}catch{return emptyPools();}
}
export function savePools(storage,pools){
 try{storage.setItem(POOL_STORAGE,JSON.stringify(pools));return true;}catch{return false;}
}
export function poolSections(rows,pool=[]){
 const ids=new Set(pool);
 if(!ids.size)return [{key:'all',title:null,rows}];
 return [
  {key:'pool',title:'Your pool',rows:rows.filter(row=>ids.has(row.id))},
  {key:'other',title:'Other champions',rows:rows.filter(row=>!ids.has(row.id))}
 ];
}
export function prioritizePool(rows,pool=[]){return poolSections(rows,pool).flatMap(section=>section.rows);}
