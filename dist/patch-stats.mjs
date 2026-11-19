import {ROLES} from './draft-math.mjs';

// Match the offline aggregation in scripts/patch_data.py. The inputs are
// ordered, distinct patches with effects already normalized within each patch.
export function combinePatchCatalogs(catalogs){
 const champions=new Map(),totals=Object.fromEntries(ROLES.map(role=>[role,0]));
 for(const catalog of catalogs){
  for(const {roles,...champion} of catalog.champions){
   const combined=champions.get(champion.id)?.roles??{};
   champions.set(champion.id,{...champion,roles:combined});
   for(const [role,value] of Object.entries(roles)){
    if(!ROLES.includes(role)||value.games<=0)continue;
    const entry=combined[role]??={games:0,wr:0};
    entry.games+=value.games;
    entry.wr+=value.games*value.wr;
    totals[role]+=value.games;
   }
  }
 }
 for(const {roles} of champions.values()){
  for(const [role,value] of Object.entries(roles)){
   value.wr/=value.games;
   value.pickRate=100*value.games/totals[role];
  }
 }
 return champions;
}

export function combinePatchRole(parts,champions,role,candidateFloor){
 const byChampion=new Map(),result={};
 for(const profiles of parts){
  for(const [id,profile] of Object.entries(profiles)){
   if(!byChampion.has(id))byChampion.set(id,[]);
   byChampion.get(id).push(profile);
  }
 }
 for(const [id,profiles] of byChampion){
  const roles=champions.get(Number(id)).roles,meta=roles[role];
  const games=profiles.reduce((sum,profile)=>sum+profile.games,0);
  if(!meta||games<1000)continue;
  if(meta.pickRate<candidateFloor){
   const primary=Object.keys(roles).reduce((best,current)=>roles[current].games>roles[best].games?current:best);
   if(primary!==role)continue;
  }
  const value={id:Number(id),role,games,wr:profiles.reduce((sum,profile)=>sum+profile.games*profile.wr,0)/games};
  for(const kind of ['enemy','ally']){
   value[kind]={};
   for(const other of ROLES){
    if(kind==='ally'&&other===role)continue;
    const pairs=value[kind][other]={};
    for(const profile of profiles){
     for(const [opponent,[delta,n,wr]] of Object.entries(profile[kind][other]??{})){
      const pair=pairs[opponent]??=[0,0,0];
      pair[0]+=delta*n;
      pair[1]+=n;
      pair[2]+=wr*n;
     }
    }
    for(const pair of Object.values(pairs)){
     pair[0]/=pair[1];
     pair[2]/=pair[1];
    }
   }
  }
  result[id]=value;
 }
 return result;
}
