import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyDraft,validateDraft} from '../web/src/domain/draft-math.ts';
import {mergeClientSnapshot,combineRoleHints} from '../web/src/domain/draft-sync.ts';
import {moveDraftChampion} from '../web/src/domain/draft-roles.ts';
const catalog=new Map(JSON.parse(readFileSync(new URL('../dist/data/draft/catalog.json',import.meta.url))).champions.map(c=>[c.id,c]));
const snapshot={sessionId:'test',playerRole:'jungle',playerChampion:35,allies:[{id:516,role:'top'},{id:103,role:'middle'}],enemies:[{id:64},{id:58}],bans:[111]};

test('client snapshots fill visible picks and bans and reserve the local player role',()=>{
 const result=mergeClientSnapshot(emptyDraft('middle'),snapshot,catalog,{newSession:true});
 assert.equal(result.draft.role,'jungle');assert.equal(result.draft.allies.jungle,null);
 assert.equal(result.draft.allies.top,516);assert.equal(result.draft.allies.middle,103);
 assert.equal(result.draft.enemies.jungle,64);assert.equal(result.draft.enemies.top,58);
 assert.equal(result.ownChampion,35);assert.deepEqual(result.draft.bans,[111]);validateDraft(result.draft);
});

test('manual corrections survive new snapshots and beat client role hints',()=>{
 const first=mergeClientSnapshot(emptyDraft(),snapshot,catalog,{newSession:true});
 const moved=moveDraftChampion(first.draft,'allies','top','middle');
 const next=mergeClientSnapshot(moved.draft,{...snapshot,enemies:[...snapshot.enemies,{id:222}]},catalog,{overrides:moved.overrides});
 assert.equal(next.draft.allies.middle,516);assert.equal(next.draft.allies.top,103);
 assert.deepEqual(combineRoleHints(next.draft,next.overrides,next.hints).allies,{103:'top',516:'middle'});
 const fresh=mergeClientSnapshot(next.draft,snapshot,catalog,{overrides:next.overrides,newSession:true});
 assert.equal(fresh.draft.allies.top,516);assert.deepEqual(fresh.overrides.allies,{});
});

test('unknown and duplicated IDs never corrupt the draft, and role override is respected',()=>{
 const data={...snapshot,playerRole:null,allies:[{id:516,role:'top'},{id:999999}],enemies:[{id:64},{id:64},{id:35}],bans:[64,111,111]};
 const result=mergeClientSnapshot(emptyDraft('middle'),data,catalog,{roleOverride:'support'});
 assert.equal(result.draft.role,'support');assert.equal(result.draft.allies.support,null);
 assert.deepEqual(result.unknown,[999999]);assert.deepEqual(result.draft.bans,[111]);validateDraft(result.draft);
 assert.equal(Object.values(result.draft.enemies).filter(id=>id===64).length,1);
});
