export const ROLES=['top','jungle','middle','bottom','support'];
export const ROLE_NAMES={top:'Top',jungle:'Jungle',middle:'Mid',bottom:'Bot',support:'Support'};
export const MAX_ROLE_MULTIPLIER=5;
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
function roleMultiplier(multipliers,side,role){
 const value=multipliers?.[side]?.[role]??1;
 if(!Number.isFinite(value)||value<0||value>MAX_ROLE_MULTIPLIER)throw Error('Role multipliers must be between 0 and 5.');
 return value;
}
export function scoreCandidate(profile,draft,{priorGames=1000,includeStrength=false,multipliers}={}) {
 const pairs=[];let counter=0,synergy=0,missing=0;
 for(const [side,kind] of [['enemies','enemy'],['allies','ally']]) {
  for(const role of ROLES) {
   const id=draft[side][role];if(id==null)continue;
   const effect=pairContribution(profile[kind]?.[role]?.[id],priorGames);
   const multiplier=roleMultiplier(multipliers,side,role),weighted=multiplier===0?0:effect?effect.adjusted*multiplier:null;
   if(weighted!=null){if(kind==='enemy')counter+=weighted;else synergy+=weighted;}
   else missing++;
   pairs.push({side,kind,role,id,...(effect??{raw:null,games:0,adjusted:null}),multiplier,weighted});
  }
 }
 const base=100*(profile.wr-.5),fit=counter+synergy;
 return {id:profile.id,role:profile.role,wr:profile.wr,base,counter,synergy,fit,
  score:fit+(includeStrength?base:0),pairs,missing,complete:missing===0,known:pairs.filter(p=>p.adjusted!=null).length,
  smallSample:pairs.some(p=>p.multiplier>0&&p.games>0&&p.games<500)};
}
export function rankDraft(draft,profiles,options={}) {
 validateDraft(draft);
 const blocked=new Set([...Object.values(draft.allies),...Object.values(draft.enemies),...(draft.bans??[])]);
 const shown=Object.values(draft.allies).filter(x=>x!=null).length+Object.values(draft.enemies).filter(x=>x!=null).length;
 const ignored=['allies','enemies'].reduce((count,side)=>count+ROLES.filter(role=>draft[side][role]!=null&&roleMultiplier(options.multipliers,side,role)===0).length,0);
 if(!shown)return {ready:false,ranked:[],insufficient:[],shown,ignored};
 const results=Object.values(profiles).filter(p=>p.role===draft.role&&!blocked.has(p.id)).map(p=>scoreCandidate(p,draft,options));
 const sort=(a,b)=>b.score-a.score||a.id-b.id;
 return {ready:true,ranked:results.filter(x=>x.complete).sort(sort),insufficient:results.filter(x=>!x.complete).sort(sort),shown,ignored};
}
