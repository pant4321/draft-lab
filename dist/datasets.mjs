import {ROLES} from './draft-math.mjs';
import {combinePatchCatalogs,combinePatchRole} from './patch-stats.mjs?v=2e034452e01d';

const files=['catalog.json',...ROLES.map(role=>role+'.json')],hashPattern=/^[a-f0-9]{64}$/;
const patchPattern=/^[1-9]\d*\.[1-9]\d*$/;
const dataPath=base=>typeof base==='string'&&/^data\/[\w./-]+$/.test(base)&&!base.split('/').some(part=>!part||part==='.'||part==='..');
const completeFiles=checksums=>files.every(file=>hashPattern.test(checksums?.[file]??''));
export class DatasetStore{
 constructor(manifest,fetcher=fetch.bind(globalThis)){
  if(manifest?.schemaVersion!==1||!Array.isArray(manifest.datasets)||!manifest.datasets.length)throw Error('Invalid dataset index.');
  this.entries=new Map();this.requests=new Map();this.fetcher=fetcher;this.defaultId=manifest.default;
  for(const entry of manifest.datasets){
   if(typeof entry.id!=='string'||!entry.id||this.entries.has(entry.id)||!dataPath(entry.base)
    ||!['combined','historical'].includes(entry.kind)||!completeFiles(entry.files))throw Error('Invalid dataset entry.');
   if(entry.patches!==undefined&&(!Array.isArray(entry.patches)||new Set(entry.patches).size!==entry.patches.length
    ||entry.patches.some(patch=>typeof patch!=='string'||!patchPattern.test(patch))))throw Error('Invalid patch list.');
   if(entry.patchInputs!==undefined&&(!Array.isArray(entry.patchInputs)||!entry.patches
    ||entry.patchInputs.length!==entry.patches.length||entry.patchInputs.some((input,index)=>input?.patch!==entry.patches[index]
     ||!dataPath(input.base)||!completeFiles(input.files))))throw Error('Invalid patch data index.');
   this.entries.set(entry.id,entry);
  }
  if(!this.entries.has(this.defaultId))throw Error('Default dataset is missing.');
 }
 entry(id){const entry=this.entries.get(id);if(!entry)throw Error('Unknown dataset.');return entry;}
 async load(id,file){
  const entry=this.entry(id);if(!files.includes(file))throw Error('Unknown dataset file.');
  return this.loadFile(entry.base,file,entry.files[file]);
 }
 async loadFile(base,file,expected,retain=true){
  const key=`${base}/${file}?v=${expected}`;
  if(!this.requests.has(key)){
   const request=(async()=>{
    const response=await this.fetcher(key);
    if(!response.ok)throw Error('Dataset could not be loaded.');
    const bytes=await response.arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==expected)throw Error('Dataset changed or is incomplete. Reload the page to get the latest snapshot.');
    return JSON.parse(new TextDecoder().decode(bytes));
   })().then(value=>{if(!retain)this.requests.delete(key);return value;},error=>{this.requests.delete(key);throw error;});
   this.requests.set(key,request);
  }
  return this.requests.get(key);
 }
 async catalog(id){
  const value=await this.load(id,'catalog.json');
  if(!Array.isArray(value.champions)||!value.profileCounts)throw Error('Champion data is incomplete.');
  return value;
 }
 async role(id,role){
  if(!ROLES.includes(role))throw Error('Unknown role.');
  const value=await this.load(id,role+'.json');
  if(!value.profiles||Array.isArray(value.profiles))throw Error('Matchup data is incomplete.');
  return value.profiles;
 }
 async select(id,exclusions=[]){
  const entry=this.entry(id),catalog=await this.catalog(id);
  const available=entry.patches??[],selected=available.filter(patch=>!exclusions.includes(patch));
  if(!selected.length||selected.length===available.length)return {entry,catalog,patches:available,role:role=>this.role(id,role)};

  const inputs=await Promise.all(selected.map(async patch=>{
   if(entry.patchInputs)return entry.patchInputs.find(input=>input.patch===patch);
   // Local development can read the already-pinned source snapshot directly.
   const component=catalog.components?.find(value=>value.patch===patch);
   if(!dataPath(component?.base)||!hashPattern.test(component.snapshotSha256??''))throw Error('Patch stats are unavailable.');
   const snapshot=await this.loadFile(component.base,'snapshot.json',component.snapshotSha256);
   if(snapshot.kind!=='patch'||snapshot.patch!==patch||!completeFiles(snapshot.files))throw Error('Patch manifest is incomplete.');
   return {patch,base:component.base,files:snapshot.files};
  }));
  const catalogs=await Promise.all(inputs.map(async input=>{
   const value=await this.loadFile(input.base,'catalog.json',input.files['catalog.json']);
   if(value.patch!==input.patch||value.rank!==entry.rank||!Array.isArray(value.champions)
    ||!Number.isFinite(Date.parse(value.asOf)))throw Error('Patch champion data is incomplete.');
   return value;
  }));
  const champions=combinePatchCatalogs(catalogs);
  const asOf=catalogs.reduce((latest,value)=>Date.parse(value.asOf)>Date.parse(latest)?value.asOf:latest,catalogs[0].asOf);
  return {
   entry,patches:selected,roster:catalog.champions,
   catalog:{rank:catalog.rank,patches:selected,asOf,champions:[...champions.values()].sort((left,right)=>left.id-right.id)},
   role:async role=>{
    if(!ROLES.includes(role))throw Error('Unknown role.');
    const file=role+'.json';
    const parts=await Promise.all(inputs.map(async input=>{
     const value=await this.loadFile(input.base,file,input.files[file],false);
     if(!value.profiles||Array.isArray(value.profiles))throw Error('Patch matchup data is incomplete.');
     return value.profiles;
    }));
    return combinePatchRole(parts,champions,role,catalog.candidateFloorRolePercent??.5);
   }
  };
 }
}
