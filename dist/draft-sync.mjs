import {ROLES,emptyDraft,validateDraft} from './draft-math.mjs';
import {assignTeamRoles,cleanRoleOverrides} from './draft-roles.mjs';

export function combineRoleHints(draft,manual,hints={}) {
 const result=cleanRoleOverrides(draft,manual);
 for(const side of ['allies','enemies']){
  const used=new Set(Object.values(result[side]));
  const present=new Set(Object.values(draft[side]));
  for(const [id,role] of Object.entries(hints[side]??{})){
   if(!present.has(+id)||!ROLES.includes(role)||result[side][id]||used.has(role)||side==='allies'&&role===draft.role)continue;
   result[side][id]=role;used.add(role);
  }
 }
 return result;
}

export function mergeClientSnapshot(current,snapshot,champions,{overrides={},newSession=false,roleOverride=null}={}) {
 const role=roleOverride??(ROLES.includes(snapshot.playerRole)?snapshot.playerRole:current.role);
 const next=emptyDraft(role),seen=new Set(),hints={allies:{},enemies:{}},unknown=[];
 const teams={allies:[],enemies:[]};
 const own=champions.has(snapshot.playerChampion)?snapshot.playerChampion:null;
 if(own)seen.add(own);
 for(const side of ['allies','enemies'])for(const pick of snapshot[side]??[]){
  if(!champions.has(pick.id)){unknown.push(pick.id);continue;}
  if(seen.has(pick.id)||teams[side].length>=(side==='allies'?4:5))continue;
  seen.add(pick.id);teams[side].push(pick.id);
  if(ROLES.includes(pick.role)&&side==='allies')hints[side][pick.id]=pick.role;
 }
 // Make a valid temporary draft so cleanup can retain corrections by champion ID.
 for(const side of ['allies','enemies']){
  const slots=ROLES.filter(r=>!(side==='allies'&&r===role));
  teams[side].forEach((id,i)=>{next[side][slots[i]]=id;});
 }
 const manual=cleanRoleOverrides(next,newSession?{}:overrides),combined=combineRoleHints(next,manual,hints);
 for(const side of ['allies','enemies'])next[side]=assignTeamRoles(teams[side],champions,{
  exclude:side==='allies'?[role]:[],overrides:combined[side],previous:newSession?{}:current[side]
 }).slots;
 for(const id of snapshot.bans??[]){
  if(champions.has(id)&&!seen.has(id)){next.bans.push(id);seen.add(id);}
 }
 validateDraft(next);
 return {draft:next,overrides:manual,hints,ownChampion:own,unknown:[...new Set(unknown)]};
}
