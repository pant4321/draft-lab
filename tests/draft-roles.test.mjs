import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROLES,emptyDraft,validateDraft,rankDraft} from '../dist/draft-math.mjs';
import {assignTeamRoles,inferDraftRoles,moveDraftChampion,cleanRoleOverrides,selectDraftRole} from '../dist/draft-roles.mjs';
const champ=(id,roles)=>({id,roles:Object.fromEntries(Object.entries(roles).map(([role,games])=>[role,{games}]))});
const catalog=new Map([champ(1,{top:600,middle:400}),champ(2,{top:990,middle:10}),champ(3,{jungle:1000}),champ(4,{bottom:1000}),champ(5,{support:1000})].map(c=>[c.id,c]));

test('selecting an occupied role inherits its champion and commits the previous preview to its original role',()=>{
 const draft=emptyDraft();draft.allies.middle=1;draft.allies.top=2;draft.enemies.support=5;draft.bans=[99];
 const overrides={allies:{1:'middle',2:'top'},enemies:{5:'support'}},before=structuredClone({draft,overrides});
 const next=selectDraftRole(draft,'middle',{preview:3,overrides});
 assert.equal(next.draft.role,'middle');assert.equal(next.selected,1);
 assert.equal(next.draft.allies.jungle,3);assert.equal(next.draft.allies.middle,null);
 assert.equal(next.draft.allies.top,2);assert.deepEqual(next.draft.enemies,draft.enemies);
 assert.deepEqual(next.draft.bans,[99]);assert.equal(next.overrides.allies[3],'jungle');
 assert.equal(next.overrides.allies[1],undefined);assert.equal(next.overrides.allies[2],'top');
 const inferred=inferDraftRoles(next.draft,catalog,next.overrides);
 assert.equal(inferred.draft.allies.jungle,3);validateDraft(inferred.draft);
 assert.deepEqual({draft,overrides},before);
 const back=selectDraftRole(next.draft,'jungle',{preview:next.selected,overrides:next.overrides});
 assert.equal(back.selected,3);assert.equal(back.draft.allies.middle,1);assert.equal(back.draft.allies.jungle,null);
});

test('empty-role selection preserves the old preview, while an occupied role can be inherited without a previous preview',()=>{
 const draft=emptyDraft();draft.allies.middle=1;
 const empty=selectDraftRole(draft,'support',{preview:3});
 assert.equal(empty.selected,null);assert.equal(empty.draft.allies.jungle,3);assert.equal(empty.draft.role,'support');
 const occupied=selectDraftRole(draft,'middle');
 assert.equal(occupied.selected,1);assert.equal(occupied.draft.allies.jungle,null);
 const same=selectDraftRole(draft,'jungle',{preview:3});
 assert.deepEqual(same.draft,draft);assert.equal(same.selected,3);
 for(const preview of [1,0,1.5])assert.throws(()=>selectDraftRole(draft,'support',{preview}));
 draft.bans=[3];assert.throws(()=>selectDraftRole(draft,'support',{preview:3}));
 assert.throws(()=>selectDraftRole(draft,'invalid'));
});

test('joint guesses resolve flex picks across the whole team, including later arrivals',()=>{
 const d=emptyDraft('support');d.enemies.top=1;
 assert.equal(inferDraftRoles(d,catalog).draft.enemies.top,1);
 d.enemies.jungle=2;
 const guess=inferDraftRoles(d,catalog);
 assert.equal(guess.draft.enemies.top,2);assert.equal(guess.draft.enemies.middle,1);
 assert.deepEqual(assignTeamRoles([1,2],catalog).slots,assignTeamRoles([2,1],catalog).slots);
 assert.equal(d.enemies.top,1); // callers' state is untouched
});

test('manual moves and swaps remain fixed while more picks arrive',()=>{
 const d=emptyDraft('support');d.enemies.top=1;d.enemies.middle=2;
 const before=JSON.stringify(d),moved=moveDraftChampion(d,'enemies','top','jungle');
 assert.equal(moved.draft.enemies.top,null);assert.equal(moved.draft.enemies.jungle,1);
 assert.equal(moved.overrides.enemies[1],'jungle');assert.equal(JSON.stringify(d),before);
 const swap=moveDraftChampion(d,'enemies','top','middle');
 assert.equal(swap.draft.enemies.middle,1);assert.equal(swap.draft.enemies.top,2);
 assert.deepEqual(swap.overrides.enemies,{'1':'middle','2':'top'});
 const corrected=moveDraftChampion(swap.draft,'enemies','middle','top',swap.overrides);
 corrected.draft.enemies.bottom=4;
 const next=inferDraftRoles(corrected.draft,catalog,corrected.overrides);
 assert.equal(next.draft.enemies.top,1);assert.equal(next.draft.enemies.middle,2);assert.equal(next.draft.enemies.bottom,4);
});

test('own role is reserved, invalid moves are rejected, stale corrections are discarded',()=>{
 const d=emptyDraft('jungle');d.allies.top=1;
 assert.throws(()=>moveDraftChampion(d,'allies','top','jungle'));
 assert.throws(()=>moveDraftChampion(d,'allies','middle','top'));
 assert.throws(()=>moveDraftChampion(d,'other','top','middle'));
 const guess=inferDraftRoles(d,catalog);assert.equal(guess.draft.allies.jungle,null);validateDraft(guess.draft);
 assert.deepEqual(cleanRoleOverrides(d,{allies:{1:'top',2:'middle'},enemies:{3:'jungle'}}),{allies:{1:'top'},enemies:{}});
 assert.throws(()=>assignTeamRoles([1,1],catalog));
 assert.throws(()=>assignTeamRoles([99],catalog));
 assert.throws(()=>assignTeamRoles([1,2],catalog,{overrides:{1:'top',2:'top'}}));
 assert.throws(()=>assignTeamRoles([1],catalog,{exclude:['top'],overrides:{1:'top'}}));
});

test('ambiguous guesses are flagged, ties retain prior slots, unsupported guesses stay correctable',()=>{
 const tied=new Map([champ(1,{top:500,middle:500}),champ(2,{top:500,middle:500})].map(c=>[c.id,c]));
 const result=assignTeamRoles([1,2],tied,{previous:{top:2,middle:1}});
 assert.equal(result.slots.top,2);assert.deepEqual(result.details[1].alternatives,['top']);
 const pinned=assignTeamRoles([1,2],tied,{overrides:{1:'top'}});
 assert.equal(pinned.details[1].manual,true);assert.deepEqual(pinned.details[1].alternatives,[]);
 const forced=assignTeamRoles([1],tied,{overrides:{1:'support'}});
 assert.equal(forced.details[1].unsupported,true);assert.equal(forced.slots.support,1);
});

test('real snapshot can assign full teams without duplicates and score their corrected roles',()=>{
 const root=new URL('../dist/data/draft/',import.meta.url);
 const catalog=new Map(JSON.parse(readFileSync(new URL('catalog.json',root))).champions.map(c=>[c.id,c]));
 const profiles=JSON.parse(readFileSync(new URL('jungle.json',root))).profiles;
 const d=emptyDraft();d.enemies=Object.fromEntries(ROLES.map((r,i)=>[r,[111,64,58,103,222][i]]));d.allies.top=516;
 const inferred=inferDraftRoles(d,catalog);validateDraft(inferred.draft);
 assert.deepEqual(Object.values(inferred.draft.enemies).sort((a,b)=>a-b),[58,64,103,111,222]);
 assert.equal(inferred.draft.enemies.jungle,64);
 const moved=moveDraftChampion(inferred.draft,'enemies','jungle','top');
 const reranked=rankDraft(moved.draft,profiles);
 assert.ok(reranked.ranked.length>0);
 assert.ok(reranked.ranked[0].pairs.some(p=>p.role==='top'&&p.id===64));
 assert.equal(inferDraftRoles(moved.draft,catalog,moved.overrides).draft.enemies.top,64);
 // Incoming snapshots may list the same champions in different slots; corrections follow IDs.
 const reordered=structuredClone(d);reordered.enemies.top=64;reordered.enemies.jungle=111;
 const retained=cleanRoleOverrides(reordered,moved.overrides);
 assert.equal(inferDraftRoles(reordered,catalog,retained).draft.enemies.top,64);
});
