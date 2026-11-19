import {ROLES,MAX_ROLE_MULTIPLIER} from './draft-math.mjs?v=d68b389b73fe';
export const WEIGHTS_STORAGE='draftlab-role-multipliers-v1';
export function defaultMultipliers(){return Object.fromEntries(['allies','enemies'].map(side=>[side,Object.fromEntries(ROLES.map(role=>[role,1]))]));}
export function cleanMultipliers(value){
 const result=defaultMultipliers();
 for(const side of ['allies','enemies'])for(const role of ROLES){
  const weight=value?.[side]?.[role];
  if(typeof weight==='number'&&Number.isFinite(weight)&&weight>=0&&weight<=MAX_ROLE_MULTIPLIER)result[side][role]=weight;
 }
 return result;
}
export function loadMultipliers(storage){try{return cleanMultipliers(JSON.parse(storage.getItem(WEIGHTS_STORAGE)));}catch{return defaultMultipliers();}}
export function saveMultipliers(storage,value){try{storage.setItem(WEIGHTS_STORAGE,JSON.stringify(cleanMultipliers(value)));return true;}catch{return false;}}
export function customMultipliers(value){return ['allies','enemies'].some(side=>ROLES.some(role=>value[side][role]!==1));}
