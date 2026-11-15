import {ROLES} from './draft-math.mjs';

const files=['catalog.json',...ROLES.map(role=>role+'.json')],hashPattern=/^[a-f0-9]{64}$/;
export class DatasetStore{
 constructor(manifest,fetcher=fetch.bind(globalThis)){
  if(manifest?.schemaVersion!==1||!Array.isArray(manifest.datasets)||!manifest.datasets.length)throw Error('Invalid dataset index.');
  this.entries=new Map();this.requests=new Map();this.fetcher=fetcher;this.defaultId=manifest.default;
  for(const entry of manifest.datasets){
   if(typeof entry.id!=='string'||!entry.id||this.entries.has(entry.id)||!/^data\/[a-zA-Z0-9_./-]+$/.test(entry.base)
    ||entry.base.split('/').some(part=>!part||part==='.'||part==='..')||!['combined','historical'].includes(entry.kind)
    ||!files.every(file=>hashPattern.test(entry.files?.[file]??'')))throw Error('Invalid dataset entry.');
   this.entries.set(entry.id,entry);
  }
  if(!this.entries.has(this.defaultId))throw Error('Default dataset is missing.');
 }
 entry(id){const entry=this.entries.get(id);if(!entry)throw Error('Unknown dataset.');return entry;}
 async load(id,file){
  const entry=this.entry(id);if(!files.includes(file))throw Error('Unknown dataset file.');
  const expected=entry.files[file],key=id+':'+file+':'+expected;
  if(!this.requests.has(key)){
   const request=(async()=>{
    const response=await this.fetcher(`${entry.base}/${file}?v=${expected}`);
    if(!response.ok)throw Error('Dataset could not be loaded.');
    const bytes=await response.arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==expected)throw Error('Dataset changed or is incomplete. Reload the page to get the latest snapshot.');
    return JSON.parse(new TextDecoder().decode(bytes));
   })().catch(error=>{this.requests.delete(key);throw error;});
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
}
