import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('entry script cache version matches its content so existing visitors receive updates',()=>{
 const root=new URL('../dist/',import.meta.url);
 const html=readFileSync(new URL('index.html',root),'utf8');
 const source=readFileSync(new URL('draft.mjs',root),'utf8').replace(/\r\n/g,'\n');
 const version=createHash('sha256').update(source).digest('hex').slice(0,12);
 assert.ok(html.includes(`src="draft.mjs?v=${version}"`),'Refresh the entry script cache version after editing draft.mjs.');
});

test('entry assets, module imports and initial data work at the GitHub Pages project path',()=>{
 const root=new URL('../dist/',import.meta.url),base=new URL('https://pant4321.github.io/draft-lab/');
 const resolveAsset=(reference,parent=base)=>{
  const url=new URL(reference,parent);
  if(url.origin!==base.origin)return null;
  assert.ok(url.pathname.startsWith(base.pathname),`Asset escapes the project path: ${url}`);
  const relative=url.pathname.slice(base.pathname.length);
  assert.ok(existsSync(new URL(relative,root)),`Missing asset: ${relative}`);
  return relative;
 };
 const html=readFileSync(new URL('index.html',root),'utf8');
 for(const [,reference] of html.matchAll(/(?:href|src)="([^"]+)"/g))resolveAsset(reference);
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
 for(const role of ['top','jungle','middle','bottom','support'])resolveAsset(`data/draft/${role}.json`);
 const catalog=JSON.parse(readFileSync(new URL('data/draft/catalog.json',root),'utf8'));
 for(const champion of catalog.champions)resolveAsset(`assets/${champion.key}.png`);
});
