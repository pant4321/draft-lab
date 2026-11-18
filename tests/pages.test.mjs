import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('entry script and stylesheet cache versions match their content for existing visitors',()=>{
 const root=new URL('../dist/',import.meta.url);
 const html=readFileSync(new URL('index.html',root),'utf8');
 for(const [file,attribute] of [['draft.mjs','src'],['draft.css','href']]){
  const source=readFileSync(new URL(file,root),'utf8').replace(/\r\n/g,'\n');
  const version=createHash('sha256').update(source).digest('hex').slice(0,12);
  assert.ok(html.includes(`${attribute}="${file}?v=${version}"`),`Refresh the cache version after editing ${file}.`);
 }
 const entry=readFileSync(new URL('draft.mjs',root),'utf8');
 for(const file of ['blindability.mjs','datasets.mjs','companion.mjs','companion-session.mjs','analytics.mjs','draft-math.mjs','draft-list.mjs','draft-weights.mjs','team-edge.mjs','draft-roles.mjs','draft-breakdown.mjs']){
  const source=readFileSync(new URL(file,root),'utf8').replace(/\r\n/g,'\n');
  const version=createHash('sha256').update(source).digest('hex').slice(0,12);
  assert.ok(entry.includes(`from './${file}?v=${version}'`),`Refresh the ${file} import version when it changes.`);
 }
 const bridge=readFileSync(new URL('companion.mjs',root),'utf8');
 const session=readFileSync(new URL('companion-session.mjs',root),'utf8').replace(/\r\n/g,'\n');
 assert.ok(bridge.includes(`from './companion-session.mjs?v=${createHash('sha256').update(session).digest('hex').slice(0,12)}'`));
 const site=readFileSync(new URL('site-location.mjs',root),'utf8').replace(/\r\n/g,'\n');
 const siteImport=`from './site-location.mjs?v=${createHash('sha256').update(site).digest('hex').slice(0,12)}'`;
 for(const file of ['analytics.mjs','companion-session.mjs'])assert.ok(readFileSync(new URL(file,root),'utf8').includes(siteImport));
 const math=readFileSync(new URL('draft-math.mjs',root),'utf8').replace(/\r\n/g,'\n');
 for(const file of ['draft-list.mjs','draft-weights.mjs'])assert.ok(readFileSync(new URL(file,root),'utf8').includes(`from './draft-math.mjs?v=${createHash('sha256').update(math).digest('hex').slice(0,12)}'`));
});

test('entry assets, module imports and initial data resolve on both site addresses',()=>{
 const root=new URL('../dist/',import.meta.url);
 for(const base of [new URL('https://draftedge.website/'),new URL('https://pant4321.github.io/draft-lab/')]){
  const resolveAsset=(reference,parent=base)=>{
   const url=new URL(reference,parent);
   if(url.origin!==base.origin)return null;
   assert.ok(url.pathname.startsWith(base.pathname),`Asset escapes the project path: ${url}`);
   const relative=url.pathname.slice(base.pathname.length);
   assert.ok(existsSync(new URL(relative,root)),`Missing asset: ${relative}`);
   return relative;
  };
  for(const page of ['index.html','privacy.html']){
   const html=readFileSync(new URL(page,root),'utf8');
   assert.match(html,/<title>[^<]*DraftEdge/);
   assert.match(html,/<link rel="icon" href="favicon\.ico">/);
   for(const [,reference] of html.matchAll(/(?:href|src)="([^"]+)"/g))resolveAsset(reference,new URL(page,base));
  }
  const pending=['draft.mjs'],seen=new Set();
  while(pending.length){
   const file=pending.pop();if(seen.has(file))continue;seen.add(file);
   const source=readFileSync(new URL(file,root),'utf8');
   for(const [,reference] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)){
    const imported=resolveAsset(reference,new URL(file,base));
    if(imported?.endsWith('.mjs'))pending.push(imported);
   }
   for(const [,reference] of source.matchAll(/fetch\(['"]([^'"]+)['"]\)/g))resolveAsset(reference);
  }
  assert.ok(seen.has('matchup-spread.mjs'));
  resolveAsset('data/datasets.json');
  const index=JSON.parse(readFileSync(new URL('data/datasets.json',root),'utf8'));
  for(const dataset of index.datasets)for(const file of Object.keys(dataset.files))resolveAsset(`${dataset.base}/${file}`);
  for(const role of ['top','jungle','middle','bottom','support'])resolveAsset(`data/draft/${role}.json`);
  const catalog=JSON.parse(readFileSync(new URL('data/draft/catalog.json',root),'utf8'));
  for(const champion of catalog.champions)resolveAsset(`assets/${champion.key}.png`);
 }
});
