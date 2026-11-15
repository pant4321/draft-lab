export const ROLES=['top','jungle','middle','bottom','support'];
export const ROLE_NAMES={top:'Top',jungle:'Jungle',middle:'Mid',bottom:'Bot',support:'Support'};
export function emptyDraft(role='jungle') {
 return {role,allies:Object.fromEntries(ROLES.map(r=>[r,null])),enemies:Object.fromEntries(ROLES.map(r=>[r,null])),bans:[]};
}
export function validateDraft(draft) {
 if(!draft||!ROLES.includes(draft.role))throw Error('Choose a valid role.');
 const seen=new Set();
 for(const side of ['allies','enemies']) {
  if(!draft[side])throw Error('Missing draft slots.');
  for(const role of ROLES) {
   const id=draft[side][role];if(id==null)continue;
   if(!Number.isInteger(id)||id<=0)throw Error('Invalid champion.');
   if(side==='allies'&&role===draft.role)throw Error('Your role must stay open for recommendations.');
   if(seen.has(id))throw Error('A champion can appear only once.');seen.add(id);
  }
 }
 for(const id of draft.bans??[]) {
  if(!Number.isInteger(id)||id<=0||seen.has(id))throw Error('A champion cannot be picked and banned, or banned twice.');
  seen.add(id);
 }
 return draft;
}
export function pairContribution(pair,priorGames=1000) {
 if(!pair||pair.length<2||!Number.isFinite(pair[0])||!Number.isInteger(pair[1])||pair[1]<=0)return null;
 if(!Number.isFinite(priorGames)||priorGames<0)throw Error('Invalid sample adjustment.');
 return {raw:pair[0],games:pair[1],adjusted:pair[0]*pair[1]/(pair[1]+priorGames)};
}
export function scoreCandidate(profile,draft,{priorGames=1000,includeStrength=false}={}) {
 const pairs=[];let counter=0,synergy=0,missing=0;
 for(const [side,kind] of [['enemies','enemy'],['allies','ally']]) {
  for(const role of ROLES) {
   const id=draft[side][role];if(id==null)continue;
   const effect=pairContribution(profile[kind]?.[role]?.[id],priorGames);
   if(effect){if(kind==='enemy')counter+=effect.adjusted;else synergy+=effect.adjusted;}
   else missing++;
   pairs.push({side,kind,role,id,...(effect??{raw:null,games:0,adjusted:null})});
  }
 }
 const base=100*(profile.wr-.5),fit=counter+synergy;
 return {id:profile.id,role:profile.role,wr:profile.wr,base,counter,synergy,fit,
  score:fit+(includeStrength?base:0),pairs,missing,complete:missing===0,known:pairs.length-missing,
  smallSample:pairs.some(p=>p.games>0&&p.games<500)};
}
export function rankDraft(draft,profiles,options={}) {
 validateDraft(draft);
 const blocked=new Set([...Object.values(draft.allies),...Object.values(draft.enemies),...(draft.bans??[])]);
 const shown=Object.values(draft.allies).filter(x=>x!=null).length+Object.values(draft.enemies).filter(x=>x!=null).length;
 if(!shown)return {ready:false,ranked:[],insufficient:[],shown};
 const results=Object.values(profiles).filter(p=>p.role===draft.role&&!blocked.has(p.id)).map(p=>scoreCandidate(p,draft,options));
 const sort=(a,b)=>b.score-a.score||a.id-b.id;
 return {ready:true,ranked:results.filter(x=>x.complete).sort(sort),insufficient:results.filter(x=>!x.complete).sort(sort),shown};
}
