import {ROLES,validateDraft} from './draft-math.mjs';

// At most five champions: enumerate all one-to-one assignments instead of guessing greedily.
export function assignTeamRoles(ids,champions,{exclude=[],overrides={},previous={}}={}) {
 const available=ROLES.filter(r=>!exclude.includes(r)),ordered=[...ids].sort((a,b)=>a-b);
 if(new Set(ids).size!==ids.length||ids.length>available.length)throw Error('Invalid team size or duplicate champion.');
 const pinned=new Map(),used=new Set();
 for(const id of ordered){
  if(!champions.has(id))throw Error('Unknown champion.');
  const role=overrides[id];if(role==null)continue;
  if(!available.includes(role)||used.has(role))throw Error('Conflicting role corrections.');
  pinned.set(id,role);used.add(role);
 }
 const solutions=[];
 function visit(index,slots,score){
  if(index===ordered.length){
   const retained=ROLES.reduce((n,r)=>n+(slots[r]!=null&&slots[r]===previous[r]?1:0),0);
   solutions.push({slots:{...slots},score,retained});return;
  }
  const id=ordered[index],champ=champions.get(id);
  const total=ROLES.reduce((sum,r)=>sum+Math.max(1,champ.roles[r]?.games??0),0);
  for(const role of available){
   if(slots[role]!=null||pinned.has(id)&&pinned.get(id)!==role||!pinned.has(id)&&used.has(role))continue;
   slots[role]=id;
   visit(index+1,slots,score+Math.log(Math.max(1,champ.roles[role]?.games??0)/total));
   delete slots[role];
  }
 }
 visit(0,{},0);
 solutions.sort((a,b)=>Math.abs(b.score-a.score)>1e-10?b.score-a.score:b.retained-a.retained);
 const best=solutions[0];if(!best)throw Error('No valid role assignment.');
 const slots=Object.fromEntries(ROLES.map(role=>[role,best.slots[role]??null])),details={};
 for(const [role,id] of Object.entries(slots)){
  if(id==null)continue;
  const alternatives=ROLES.filter(other=>other!==role&&solutions.some(s=>best.score-s.score<=Math.log(2)+1e-10&&s.slots[other]===id));
  details[id]={role,manual:pinned.has(id),alternatives,unsupported:!champions.get(id).roles[role]};
 }
 return {slots,details};
}

export function cleanRoleOverrides(draft,overrides={}) {
 return Object.fromEntries(['allies','enemies'].map(side=>{
  const present=new Set(Object.values(draft[side])),used=new Set();
  return [side,Object.fromEntries(Object.entries(overrides[side]??{}).filter(([id,role])=>{
   if(!present.has(+id)||!ROLES.includes(role)||side==='allies'&&role===draft.role||used.has(role))return false;
   used.add(role);return true;
  }))];
 }));
}

export function inferDraftRoles(draft,champions,overrides={}) {
 validateDraft(draft);
 const next=structuredClone(draft),details={};
 for(const side of ['allies','enemies']){
  const result=assignTeamRoles(Object.values(draft[side]).filter(id=>id!=null),champions,{
   exclude:side==='allies'?[draft.role]:[],overrides:overrides[side]??{},previous:draft[side]
  });
  next[side]=result.slots;details[side]=result.details;
 }
 validateDraft(next);return {draft:next,details};
}

export function moveDraftChampion(draft,side,from,to,overrides={}) {
 validateDraft(draft);
 if(!['allies','enemies'].includes(side)||!ROLES.includes(from)||!ROLES.includes(to))throw Error('Invalid role move.');
 if(side==='allies'&&(from===draft.role||to===draft.role))throw Error('Your role stays open for recommendations.');
 const id=draft[side][from];if(id==null)throw Error('Choose a champion to move.');
 const next=structuredClone(draft),pins=structuredClone(overrides);
 pins[side]??={};
 const displaced=next[side][to];next[side][to]=id;next[side][from]=displaced;
 pins[side][id]=to;if(displaced!=null)pins[side][displaced]=from;
 validateDraft(next);return {draft:next,overrides:cleanRoleOverrides(next,pins)};
}
