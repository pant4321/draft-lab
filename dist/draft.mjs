import {ROLES,ROLE_NAMES,emptyDraft,validateDraft} from './draft-math.mjs?v=83c2e3d1ba0f';
import {recommendationList,sortPickerChampions} from './draft-list.mjs?v=08ffed6cfc9a';
import {roleBlindability,remainingCounters,suggestedPoolBans} from './blindability.mjs?v=4f5efea94ee1';
import {inferDraftRoles,moveDraftChampion,cleanRoleOverrides,selectDraftRole} from './draft-roles.mjs?v=ae75d9f318bc';
import {mergeClientSnapshot,combineRoleHints} from './draft-sync.mjs';
import {connectCompanion} from './companion.mjs?v=2080818cd4b3';
import {prepareCompanionSession} from './companion-session.mjs?v=90ce12900bef';
import {startAnalytics} from './analytics.mjs?v=cb37a77fa3e1';
import {matchupSpreadGraph} from './matchup-spread.mjs';
import {retainPopupFocus,dismissOnBackdrop} from './overlays.mjs';
import {emptyPools,loadPools,savePools,poolSections,prioritizePool} from './champion-pool.mjs';
import {DatasetStore} from './datasets.mjs?v=b605a99aaef9';
import {defaultMultipliers,loadMultipliers,saveMultipliers,customMultipliers} from './draft-weights.mjs?v=0465e432aded';
import {scoreTeamDraft} from './team-edge.mjs?v=36357097f939';
import {contributionBreakdown,remainingCounterCards,poolBanList} from './draft-breakdown.mjs?v=bee611040a3e';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=v=>(v>0?'+':'')+v.toFixed(2),tone=v=>v>.005?'positive':v<-.005?'negative':'zero';
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,''),num=n=>n.toLocaleString('en-US');
const STORAGE='draftlab-draft-v1';
const companionSession=prepareCompanionSession();
startAnalytics();
let catalog,champions=new Map(),draft=emptyDraft(),profiles={},ranking=null,selected=null,includeStrength=false,picker=null,revision=0;
let autoRoles=false,roleOverrides={allies:{},enemies:{}},roleDetails={},dragging=null,dragPress=null,dragPreview=null,suppressDragClickUntil=0;
let companion=null,clientSyncing=false,clientHints={},clientOwnChampion=null,clientSession=null,clientRoleOverride=null,queuedClientSnapshot=null;
let pools=emptyPools(),poolRole=null,inheritedSelection=false,poolBanMarkup='';
let datasets,activeDataset=null,datasetLoading=true,datasetRevision=0;
let blindByRole={};
let multipliers=defaultMultipliers();try{multipliers=loadMultipliers(localStorage);}catch{}
function champion(id){return champions.get(Number(id));}
function blindInfo(id){return blindByRole[draft.role]?.[id];}
function blindTitle(id){const b=blindInfo(id);return b?.score!=null?`Counterpick safety: ${b.score}/100 among ${b.comparedWith} ${ROLE_NAMES[draft.role].toLowerCase()} picks. ${b.counterLoss.toFixed(2)} pp weighted downside across five enemy roles. Negative matchup deltas are sample-adjusted and multiplied by opponent role pick-rate share. Rare picks count less. Base WR, positive bonuses, and ally synergy do not affect this score. Independent of draft edge.`:(b?.reason??'Not enough comparable role data.');}
function blindCell(id){const b=blindInfo(id);return `<button type="button" data-blind="${id}" aria-haspopup="dialog" aria-expanded="false" aria-controls="blindability-popover" class="blind-score ${b?.score!=null?(b.score>=67?'blind-high':b.score<=33?'blind-low':'blind-mid'):'zero'}" aria-label="${esc(champion(id).name)} matchup WR delta spread. ${esc(blindTitle(id))}">${b?.score!=null?b.score+'<small>/100</small>':'—'}</button>`;}
function img(id,cls='portrait'){const c=champion(id);return c?`<img class="${cls}" draggable="false" src="assets/${esc(c.key)}.png" alt="">`:'';}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({draft,includeStrength,autoRoles,roleOverrides,selected,inheritedSelection}));}catch{}}
function restore(){try{const value=JSON.parse(localStorage.getItem(STORAGE));if(value?.draft){validateDraft(value.draft);for(const id of [...Object.values(value.draft.allies),...Object.values(value.draft.enemies),...value.draft.bans])if(id!=null&&!champions.has(id))throw Error('Unknown saved champion.');draft=value.draft;includeStrength=!!value.includeStrength;autoRoles=!!value.autoRoles;roleOverrides=cleanRoleOverrides(draft,value.roleOverrides);const blocked=[...Object.values(draft.allies),...Object.values(draft.enemies),...draft.bans];selected=champions.has(value.selected)&&!blocked.includes(value.selected)?value.selected:null;inheritedSelection=selected!=null&&!!value.inheritedSelection;}}catch{draft=emptyDraft();selected=null;inheritedSelection=false;}}
function renderTeamEdge(message=null){
 const own=clientOwnChampion??selected;
 const blocked=[...Object.values(draft.allies),...Object.values(draft.enemies),...draft.bans];
 const ownChampion=own!=null&&!blocked.includes(own)?own:null;
 const loading=datasetLoading||ROLES.some(role=>(role===draft.role||draft.allies[role]!=null)&&!profiles[role]);
 const total=message||loading?null:scoreTeamDraft(draft,profiles,{ownChampion,includeStrength,multipliers});
 const show=(id,value)=>{const element=$(id);element.textContent=value==null?'—':signed(value);element.className=(id==='team-edge-total'?'team-edge-total ':'')+(value==null?'zero':tone(value));};
 show('team-edge-total',total?.ready?total.score:null);
 show('team-edge-counter',total?.ready?total.counter:null);
 show('team-edge-synergy',total?.ready?total.synergy:null);
 show('team-edge-base',total?.ready?total.base:null);
 $('team-edge-base-part').hidden=!includeStrength;
 $('team-edge-total').title=loading?'Calculating team edge':ownChampion!=null&&!clientOwnChampion?'Includes your selected champion preview':'Current allied draft';
 $('team-edge-note').textContent=message??(total?.ready&&!total.complete?'Some selected roles are missing matchup data.':'');
 $('team-edge-note').hidden=!$('team-edge-note').textContent;
}
function renderBoard(){
 renderTeamEdge();
 for(const side of ['allies','enemies']) {
  $(side).innerHTML=ROLES.map(role=>{
   const own=side==='allies'&&role===draft.role;
   const id=own?(clientOwnChampion??selected):draft[side][role],c=champion(id),name=c?.name??(own?'':'Choose champion');
   const fixed=!own&&roleOverrides[side]?.[id]===role,guess=!own&&roleDetails[side]?.[id];
   const uncertain=guess&&!fixed&&(guess.unsupported||guess.alternatives.length);
   const hint=fixed?'Manual role. Auto guess roles will keep this correction.':uncertain?(guess.unsupported?'Limited role data. Drag to correct.':'Could also be '+guess.alternatives.map(r=>ROLE_NAMES[r]).join(' or ')+'. Drag to correct.'):'Drag to move; drop on a champion to swap roles.';
   const marker=fixed?'<span class="role-marker fixed" title="Manual role correction">SET</span>':uncertain?'<span class="role-marker uncertain" title="'+esc(hint)+'">?</span>':'';
   const body=`${c?img(id):'<span class="placeholder">'+(own?'◈':'+')+'</span>'}<span class="slot-text"><span class="slot-role">${ROLE_NAMES[role]}${marker}${own?'<span class="you-tag">'+(clientOwnChampion?'LOCKED':c?'PREVIEW':'YOU')+'</span>':''}</span><span class="slot-name">${esc(name)}</span></span>`;
   return `<div data-slot-side="${side}" data-slot-role="${role}" class="slot ${own?'you':!c?'slot-empty':''}">${own?`<div class="slot-main" aria-label="Your ${ROLE_NAMES[role]} pick preview">${body}</div>`:`<button class="slot-main" draggable="${!!c}" title="${c?esc(hint):''}" data-side="${side}" data-role="${role}" aria-label="Choose ${side==='allies'?'allied':'enemy'} ${ROLE_NAMES[role]}">${body}</button>`}${!own&&c?`<button class="slot-move" data-move="${side}" data-role="${role}" aria-label="Move ${esc(c.name)} to another ${side==='allies'?'allied':'enemy'} role" title="Move or swap role">↔</button><button class="slot-clear" data-clear="${side}" data-role="${role}" aria-label="Remove ${esc(c.name)} from ${side==='allies'?'allied':'enemy'} ${ROLE_NAMES[role]}">×</button>`:''}</div>`;
  }).join('');
 }
 document.querySelectorAll('.slot-main[data-side]').forEach(b=>b.onclick=()=>openPicker({side:b.dataset.side,role:b.dataset.role}));
 document.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>{pauseForManualEdit();draft[b.dataset.clear][b.dataset.role]=null;update();});
 $('allied-count').textContent=Object.values(draft.allies).filter(x=>x!=null).length+' revealed';
 $('enemy-count').textContent=Object.values(draft.enemies).filter(x=>x!=null).length+' revealed';
 document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>openRoleMover(b.dataset.move,b.dataset.role));
 $('auto-roles').checked=autoRoles;$('auto-roles').disabled=clientSyncing;
 $('auto-roles-sync-note').hidden=!clientSyncing;
 $('clear-role-pins').hidden=!Object.values(roleOverrides).some(p=>Object.keys(p).length);
 document.querySelectorAll('[data-your-role]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.yourRole===draft.role));button.disabled=datasetLoading;});
 $('include-strength').checked=includeStrength;
 $('edit-pool').textContent='Your pool'+(pools[draft.role].length?' · '+pools[draft.role].length:'');
 $('edit-pool').disabled=!profiles[draft.role];
 $('draft-settings').textContent=customMultipliers(multipliers)?'Settings · custom':'Settings';
 $('ban-chips').innerHTML=draft.bans.map(id=>`<button class="ban-chip" data-unban="${id}" aria-label="Unban ${esc(champion(id).name)}">${img(id,'')}<span>${esc(champion(id).name)} ×</span></button>`).join('');
 document.querySelectorAll('[data-unban]').forEach(b=>b.onclick=()=>{pauseForManualEdit();draft.bans=draft.bans.filter(id=>id!==+b.dataset.unban);update();});
}
function renderRanking(){
 hideSpread();
 if(!ranking)return;
 const blind=ranking.mode==='blindability';
 const allied=Object.values(draft.allies).filter(x=>x!=null).length,enemy=Object.values(draft.enemies).filter(x=>x!=null).length;
 $('ranking-title').textContent=blind?`Blind picks for ${ROLE_NAMES[draft.role]}`:'Best picks for this draft';
 $('ranking-context').textContent=blind?'Sorted by blindability':`${ROLE_NAMES[draft.role]} · ${allied} ${allied===1?'ally':'allies'} · ${enemy} ${enemy===1?'enemy':'enemies'} · Sorted by draft edge${customMultipliers(multipliers)?' · Custom weights':''}`;
 $('include-strength').disabled=blind;
 const query=norm($('candidate-search').value);
 const sections=poolSections(ranking.ranked,pools[draft.role]).map(section=>({...section,rows:section.rows
  .map((row,index)=>({...row,index:index+1})).filter(row=>norm(champion(row.id).name).includes(query))}));
 const hasRows=sections.some(section=>section.rows.length);
 $('rankings').innerHTML=sections.map(section=>{
  if(!section.rows.length)return section.key==='pool'&&!query?'<h2 class="ranking-group">Your pool</h2><p class="pool-unavailable">None available for this draft.</p>':'';
  const heading=section.title?`<h2 class="ranking-group">${section.title} <span>${section.rows.length}</span></h2>`:'';
  return heading+section.rows.map(row=>`<div class="pick ${row.id===selected?'selected':''}" data-pool-group="${section.key}"><button class="pick-inspect" data-candidate="${row.id}" aria-label="Inspect ${esc(champion(row.id).name)}, rank ${row.index}${section.title?' in '+section.title.toLowerCase():''}${blind?'':', draft edge '+signed(row.score)}"></button><span class="pick-lead"><span class="pick-rank">${row.index}</span>${img(row.id)}<span class="pick-name">${esc(champion(row.id).name)}<small>${(100*row.wr).toFixed(1)}% WR${row.smallSample?' · small samples':''}</small></span></span><span class="pick-pair ${blind?'zero':tone(row.counter)}">${blind?'—':signed(row.counter)}</span><span class="pick-pair ${blind?'zero':tone(row.synergy)}">${blind?'—':signed(row.synergy)}</span>${blindCell(row.id)}<span class="pick-total ${blind?'zero':tone(row.score)}">${blind?'—':signed(row.score)}</span></div>`).join('');
 }).join('')+(!hasRows?'<div class="empty"><h3>No matching recommendations.</h3><p>Clear your search or change the draft.</p></div>':'');
 document.querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>{selected=+b.dataset.candidate;inheritedSelection=false;persist();renderRanking();renderBoard();renderBreakdown();});
}
function renderPoolBans(){
 const roleProfiles=profiles[draft.role],pool=pools[draft.role];
 const button=$('pool-bans-button'),popover=$('pool-bans-popover');
 button.disabled=datasetLoading||!roleProfiles;
 if(button.disabled){
  if(popover.hidePopover&&popover.matches(':popover-open'))popover.hidePopover();
  return;
 }
 const bans=suggestedPoolBans(roleProfiles,pool,catalog.champions,draft,{ownChampion:clientOwnChampion});
 const banList=poolBanList(bans,{champion,portrait:id=>img(id,''),hasPool:pool.length>0});
 if(poolBanMarkup!==banList){
  const results=$('pool-bans-list');
  const expanded=results.querySelector('details[open]')?.dataset.poolBanId;
  const focused=document.activeElement?.closest('[data-pool-ban-id]')?.dataset.poolBanId;
  results.innerHTML=poolBanMarkup=banList;
  const previous=expanded&&results.querySelector(`[data-pool-ban-id="${expanded}"]`);
  if(previous)previous.open=true;
  if(focused)(results.querySelector(`[data-pool-ban-id="${focused}"] summary`)??button).focus({preventScroll:true});
 }
}
function renderBreakdown(){
 const row=ranking?.ranked.find(x=>x.id===selected);
 const options={champion,portrait:id=>img(id,''),includeStrength};
 const threats=row?remainingCounters(profiles[draft.role][row.id],catalog.champions,draft,{ownChampion:clientOwnChampion}):null;
 $('breakdown').hidden=!row;
 $('counter-tools').hidden=threats===null;
 $('remaining-counters-caption').hidden=!threats?.length;
 const method=$('remaining-counter-method');
 if(threats===null&&method.hidePopover&&method.matches(':popover-open'))method.hidePopover();
 $('remaining-counters-cards').innerHTML=remainingCounterCards(threats,options);
 if(row&&ranking.mode==='blindability'){
  const c=champion(row.id),info=blindInfo(row.id);
  $('pick-breakdown').innerHTML=`<div class="breakdown-head"><div><h2>${esc(c.name)}</h2><p>${(100*row.wr).toFixed(1)}% WR · ${info?.counterLoss!=null?info.counterLoss.toFixed(2)+' pp weighted downside':'Downside unavailable'}</p></div><span class="blind-detail">Blindability ${blindCell(row.id)}</span></div>`;
  return;
 }
 $('pick-breakdown').innerHTML=row?contributionBreakdown(row,options):'';
}
async function update(){
 if(datasetLoading)return;
 clearDrag();hideSpread();const current=++revision;$('status').textContent='';
 try{
  roleOverrides=cleanRoleOverrides(draft,roleOverrides);roleDetails={};
  if(autoRoles){const guess=inferDraftRoles(draft,champions,combineRoleHints(draft,roleOverrides,clientHints));draft=guess.draft;roleDetails=guess.details;}
  persist();renderBoard();
  if(!profiles[draft.role]){
   renderPoolBans();
   ranking=null;$('breakdown').hidden=true;
   $('ranking-context').textContent='Loading '+ROLE_NAMES[draft.role].toLowerCase()+' pairs…';
   $('rankings').innerHTML='<div class="empty"><h3>Loading '+ROLE_NAMES[draft.role].toLowerCase()+' matchups…</h3></div>';
  }
  const needed=ROLES.filter(role=>(role===draft.role||draft.allies[role]!=null)&&!profiles[role]);
  const datasetId=activeDataset.id;
  const loaded=await Promise.all(needed.map(async role=>[role,await datasets.role(datasetId,role)]));
  if(current!==revision||activeDataset.id!==datasetId)return;
  for(const [role,values] of loaded)profiles[role]=values;
  if(current!==revision)return;
  renderPoolBans();
  if(!blindByRole[draft.role]){
   blindByRole[draft.role]=roleBlindability(profiles[draft.role],catalog.champions);
  }
  ranking=recommendationList(draft,profiles[draft.role],blindByRole[draft.role],champions,{includeStrength,multipliers});
  ranking={...ranking,ranked:prioritizePool(ranking.ranked,pools[draft.role])};
  if([...Object.values(draft.allies),...Object.values(draft.enemies),...draft.bans].includes(selected)){selected=null;inheritedSelection=false;}
  if(!inheritedSelection&&!ranking.ranked.some(x=>x.id===selected))selected=ranking.mode==='blindability'?null:ranking.ranked[0]?.id??null;
  persist();
  renderRanking();renderBoard();renderBreakdown();
 }catch(e){if(current===revision){renderTeamEdge('Team data unavailable. Try selecting your role again.');$('status').textContent=e.message;$('rankings').innerHTML='<div class="empty"><h3>Data unavailable.</h3><p>Try selecting your role again.</p></div>';$('breakdown').hidden=true;}}
}
function openPicker(target){
 pauseForManualEdit();hideSpread();picker=target;$('picker-title').textContent=target.ban?'Choose bans':`Choose ${target.side==='allies'?'allied':'enemy'} ${ROLE_NAMES[target.role]}`;
 $('picker-search').value='';renderPicker();$('champion-picker').showModal();$('picker-search').focus();
}
function renderPicker(){
 if(!picker)return;
 const query=norm($('picker-search').value),taken=new Set([...Object.values(draft.allies),...Object.values(draft.enemies)]);
 const targetId=picker.ban?null:draft[picker.side][picker.role];if(targetId)taken.delete(targetId);
 const role=picker.role??draft.role;
 $('picker-order').textContent=`Most played in ${ROLE_NAMES[role]}`;
 const values=sortPickerChampions(champions.values(),role).filter(c=>norm(c.name).includes(query));
 $('picker-list').innerHTML=values.map(c=>{const banned=draft.bans.includes(c.id),disabled=taken.has(c.id)||(!picker.ban&&banned);return `<button class="champ-option ${banned?'banned':''}" data-pick="${c.id}" ${disabled?'disabled':''} aria-label="${picker.ban?(banned?'Unban ':'Ban '):'Pick '}${esc(c.name)}">${img(c.id,'')}<span>${esc(c.name)}</span></button>`;}).join('')||'<p>No champions found.</p>';
 document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
  const id=+b.dataset.pick;
  if(picker.ban){draft.bans=draft.bans.includes(id)?draft.bans.filter(x=>x!==id):[...draft.bans,id];update();renderPicker();$('picker-search').focus();}
  else{delete roleOverrides[picker.side][draft[picker.side][picker.role]];draft[picker.side][picker.role]=id;$('champion-picker').close();picker=null;update();}
 });
}
function renderSettings(){
 $('weight-rows').innerHTML=ROLES.map(role=>`<tr><th scope="row">${ROLE_NAMES[role]}</th>${['allies','enemies'].map(side=>`<td><label class="weight-input"><input type="number" min="0" max="5" step="0.1" required value="${multipliers[side][role]}" data-weight-side="${side}" data-weight-role="${role}" aria-label="${ROLE_NAMES[role]} ${side==='allies'?'synergy':'counter'} multiplier"><span aria-hidden="true">×</span></label></td>`).join('')}</tr>`).join('');
 $('weights-error').textContent='';
 document.querySelectorAll('[data-weight-side]').forEach(input=>input.oninput=()=>{
  if(!input.checkValidity()){$('weights-error').textContent='Use a number from 0 to 5 in steps of 0.1.';return;}
  $('weights-error').textContent='';multipliers[input.dataset.weightSide][input.dataset.weightRole]=Number(input.value);
  try{saveMultipliers(localStorage,multipliers);}catch{}update();
 });
}
$('companion-download-open').onclick=()=>{hideSpread();$('companion-download-dialog').showModal();};
$('companion-download-close').onclick=()=>$('companion-download-dialog').close();
dismissOnBackdrop($('companion-download-dialog'),()=>$('companion-download-dialog').close());
$('draft-settings').onclick=()=>{hideSpread();renderSettings();$('draft-settings-dialog').showModal();};
$('close-settings').onclick=()=>$('draft-settings-dialog').close();
$('settings-done').onclick=()=>{
 const invalid=[...document.querySelectorAll('[data-weight-side]')].find(input=>!input.checkValidity());
 if(invalid){invalid.reportValidity();return;}$('draft-settings-dialog').close();
};
$('reset-weights').onclick=()=>{multipliers=defaultMultipliers();try{saveMultipliers(localStorage,multipliers);}catch{}renderSettings();update();};
dismissOnBackdrop($('draft-settings-dialog'),()=>$('draft-settings-dialog').close());
function persistPools(){try{savePools(localStorage,pools);}catch{}}
function openPool(){
 if(!profiles[draft.role])return;
 hideSpread();poolRole=draft.role;$('pool-title').textContent='Your '+ROLE_NAMES[poolRole]+' pool';
 $('pool-search').value='';renderPool();$('pool-picker').showModal();$('pool-search').focus();
}
function closePool(){$('pool-picker').close();poolRole=null;}
function changePool(id){
 const values=pools[poolRole];pools[poolRole]=values.includes(id)?values.filter(value=>value!==id):[...values,id];
 persistPools();renderPool();update();
 document.querySelector(`#pool-list [data-pool-pick="${id}"]`)?.focus({preventScroll:true});
}
function renderPool(){
 if(!poolRole)return;
 const ids=new Set(pools[poolRole]),query=norm($('pool-search').value);
 $('pool-selected').innerHTML=pools[poolRole].map(id=>`<button class="pool-chip" data-pool-remove="${id}" aria-label="Remove ${esc(champion(id).name)} from your ${ROLE_NAMES[poolRole]} pool">${img(id,'')}<span>${esc(champion(id).name)} ×</span></button>`).join('');
 const values=sortPickerChampions(champions.values(),poolRole).filter(c=>profiles[poolRole][c.id]&&norm(c.name).includes(query));
 $('pool-list').innerHTML=values.map(c=>`<button class="champ-option pool-choice ${ids.has(c.id)?'in-pool':''}" data-pool-pick="${c.id}" aria-pressed="${ids.has(c.id)}" aria-label="${ids.has(c.id)?'Remove ':'Add '}${esc(c.name)} ${ids.has(c.id)?'from':'to'} your ${ROLE_NAMES[poolRole]} pool">${img(c.id,'')}<span>${esc(c.name)}</span></button>`).join('')||'<p>No champions found.</p>';
 $('pool-count').textContent=ids.size+' '+(ids.size===1?'champion':'champions');$('clear-pool').hidden=!ids.size;
 document.querySelectorAll('[data-pool-pick]').forEach(button=>button.onclick=()=>changePool(+button.dataset.poolPick));
 document.querySelectorAll('[data-pool-remove]').forEach(button=>button.onclick=()=>changePool(+button.dataset.poolRemove));
}
function openRoleMover(side,role){
 hideSpread();const id=draft[side][role];if(id==null)return;
 $('role-mover-title').textContent='Move '+champion(id).name;
 $('role-move-options').innerHTML=ROLES.filter(r=>r!==role&&!(side==='allies'&&r===draft.role)).map(r=>`<button class="role-option" data-move-to="${r}" aria-label="Move ${esc(champion(id).name)} to ${side==='allies'?'allied':'enemy'} ${ROLE_NAMES[r]}"><span>${ROLE_NAMES[r]}</span><small>${draft[side][r]!=null?'Swap with '+esc(champion(draft[side][r]).name):'Open'}</small></button>`).join('');
 document.querySelectorAll('[data-move-to]').forEach(b=>b.onclick=()=>applyRoleMove(side,role,b.dataset.moveTo,id,true));
 $('role-mover').showModal();
}
async function applyRoleMove(side,from,to,id,focus=false){
 try{
  if(draft[side][from]!==id)throw Error('The draft changed. Try moving the champion again.');
  const moved=moveDraftChampion(draft,side,from,to,roleOverrides);draft=moved.draft;roleOverrides=moved.overrides;
  $('role-mover').close();await update();flushQueuedClient();
  if(focus)document.querySelector(`[data-move="${side}"][data-role="${to}"]`)?.focus({preventScroll:true});
 }catch(e){$('status').textContent=e.message;}
}
function clearDrag(){
 if(dragPress&&document.documentElement.hasPointerCapture(dragPress.pointerId))document.documentElement.releasePointerCapture(dragPress.pointerId);
 dragPreview?.remove();dragPreview=null;document.body.classList.remove('is-dragging');
 document.querySelectorAll('.drop-target,.dragging,.grabbed').forEach(el=>el.classList.remove('drop-target','dragging','grabbed'));dragging=null;dragPress=null;
}
function validDrop(slot){return dragging&&slot&&slot.dataset.slotSide===dragging.side&&!(dragging.side==='allies'&&slot.dataset.slotRole===draft.role);}
document.addEventListener('pointerdown',e=>{
 if(e.button!==0||e.pointerType!=='mouse')return;
 const source=e.target.closest('.slot-main[draggable="true"]');if(!source)return;
 const side=source.dataset.side,role=source.dataset.role,id=draft[side][role];if(id==null)return;
 clearDrag();hideSpread();const card=source.closest('.slot'),rect=card.getBoundingClientRect();
 dragPress={side,role,id,card,pointerId:e.pointerId,x:e.clientX,y:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top,width:rect.width,height:rect.height};
 card.classList.add('grabbed');
});
// Use an opaque floating card instead of the browser's faint native drag image.
document.addEventListener('pointermove',e=>{
 if(!dragPress||e.pointerId!==dragPress.pointerId)return;
 if(!dragging){
  if(Math.hypot(e.clientX-dragPress.x,e.clientY-dragPress.y)<5)return;
  dragging={side:dragPress.side,role:dragPress.role,id:dragPress.id};
  document.documentElement.setPointerCapture(e.pointerId);document.body.classList.add('is-dragging');
  dragPreview=dragPress.card.cloneNode(true);dragPreview.classList.remove('grabbed');dragPreview.classList.add('drag-preview');
  dragPreview.removeAttribute('data-slot-side');dragPreview.removeAttribute('data-slot-role');dragPreview.setAttribute('aria-hidden','true');dragPreview.inert=true;
  dragPreview.querySelectorAll('.slot-move,.slot-clear').forEach(el=>el.remove());
  dragPreview.style.width=dragPress.width+'px';dragPreview.style.height=dragPress.height+'px';
  document.body.append(dragPreview);dragPress.card.classList.remove('grabbed');dragPress.card.classList.add('dragging');
 }
 e.preventDefault();dragPreview.style.left=(e.clientX-dragPress.offsetX)+'px';dragPreview.style.top=(e.clientY-dragPress.offsetY)+'px';
 const slot=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot-side]');
 document.querySelectorAll('.drop-target').forEach(el=>{if(el!==slot||!validDrop(slot))el.classList.remove('drop-target');});
 if(validDrop(slot))slot.classList.add('drop-target');
},{passive:false});
document.addEventListener('pointerup',e=>{
 if(!dragPress||e.pointerId!==dragPress.pointerId)return;
 const source=dragging,slot=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot-side]'),to=validDrop(slot)?slot.dataset.slotRole:null;
 if(source){e.preventDefault();suppressDragClickUntil=performance.now()+250;}
 clearDrag();if(source&&to&&source.role!==to)applyRoleMove(source.side,source.role,to,source.id);
 flushQueuedClient();
});
document.addEventListener('pointercancel',()=>{clearDrag();flushQueuedClient();});
window.addEventListener('blur',()=>{clearDrag();flushQueuedClient();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dragPress){e.preventDefault();suppressDragClickUntil=performance.now()+250;clearDrag();flushQueuedClient();}});
document.addEventListener('dragstart',e=>{if(e.target.closest('.slot-main[draggable="true"]'))e.preventDefault();});
document.addEventListener('click',e=>{if(performance.now()<suppressDragClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
$('close-role-mover').onclick=()=>{$('role-mover').close();flushQueuedClient();};
$('role-mover').addEventListener('cancel',()=>setTimeout(flushQueuedClient,0));
const spreadPopup=$('blindability-popover');
let spreadTrigger=null,spreadTimer,suppressedTrigger=null;
retainPopupFocus(spreadPopup,()=>clearTimeout(spreadTimer));
let graphCache={};
function hideSpread(){
 clearTimeout(spreadTimer);
 if(spreadTrigger)spreadTrigger.setAttribute('aria-expanded','false');
 spreadTrigger=null;spreadPopup.hidden=true;
}
function dismissSpread(){const t=spreadTrigger;suppressedTrigger=t;hideSpread();t?.focus({preventScroll:true});}
function showSpread(trigger){
 clearTimeout(spreadTimer);
 if(spreadTrigger===trigger&&!spreadPopup.hidden)return;
 hideSpread();spreadTrigger=trigger;trigger.setAttribute('aria-expanded','true');
 const id=+trigger.dataset.blind,c=champion(id);
 const options=['enemy','ally'].flatMap(kind=>ROLES.filter(role=>kind==='enemy'||role!==draft.role).map(role=>`<option value="${kind}:${role}" ${kind==='enemy'&&role===draft.role?'selected':''}>${kind==='enemy'?'vs':'with'} ${ROLE_NAMES[role]}</option>`)).join('');
 const info=blindInfo(id);
 spreadPopup.innerHTML=`<div class="spread-head"><h2 id="spread-title">${esc(c.name)} <span>· ${ROLE_NAMES[draft.role]}</span></h2><div class="spread-actions"><select id="spread-group" aria-label="Spread matchup group">${options}</select><button type="button" class="spread-close" aria-label="Close spread graph">×</button></div></div><p class="spread-rating" title="${esc(blindTitle(id))}">${info.counterLoss!=null?info.counterLoss.toFixed(2)+' pp weighted downside':'Downside unavailable'}<span>Spread visual only</span></p><div id="spread-chart"></div>`;
 const renderGraph=()=>{
  const [kind,role]=$('spread-group').value.split(':'),key=draft.role+':'+id+':'+kind+':'+role;
  if(!graphCache[key])graphCache[key]=matchupSpreadGraph(blindInfo(id),champions,id,kind,role);
  $('spread-chart').innerHTML=graphCache[key];
  positionSpread(trigger);
 };
 spreadPopup.querySelector('.spread-close').onclick=dismissSpread;
 spreadPopup.hidden=false;renderGraph();
 $('spread-group').onchange=renderGraph;
}
function positionSpread(trigger){
 const rect=trigger.getBoundingClientRect(),box=spreadPopup.getBoundingClientRect();
 spreadPopup.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.right-box.width))+'px';
 const below=rect.bottom+10,above=rect.top-box.height-10;
 spreadPopup.style.top=Math.max(8,Math.min(innerHeight-box.height-8,below+box.height<=innerHeight-8?below:above))+'px';
}
function deferHide(){clearTimeout(spreadTimer);spreadTimer=setTimeout(hideSpread,160);}
document.addEventListener('pointerover',e=>{
 const trigger=e.target.closest('[data-blind]');
 if(trigger&&trigger!==suppressedTrigger)showSpread(trigger);
 else if(spreadPopup.contains(e.target))clearTimeout(spreadTimer);
});
document.addEventListener('pointerout',e=>{
 if(e.target.closest('[data-blind]')===suppressedTrigger&&!suppressedTrigger?.contains(e.relatedTarget))suppressedTrigger=null;
 if(e.target.closest('[data-blind]')||spreadPopup.contains(e.target)){
  if(!spreadTrigger?.contains(e.relatedTarget)&&!spreadPopup.contains(e.relatedTarget))deferHide();
 }
});
document.addEventListener('focusin',e=>{const t=e.target.closest('[data-blind]');if(t&&t!==suppressedTrigger)showSpread(t);else if(!spreadPopup.contains(e.target)){hideSpread();if(e.target!==suppressedTrigger)suppressedTrigger=null;}});
document.addEventListener('focusout',e=>{if(e.target===suppressedTrigger)suppressedTrigger=null;if(!spreadPopup.contains(e.relatedTarget)&&!e.relatedTarget?.closest('[data-blind]'))deferHide();});
document.addEventListener('click',e=>{const t=e.target.closest('[data-blind]');if(t){suppressedTrigger=null;showSpread(t);if(e.detail===0)$('spread-group').focus();}else if(!spreadPopup.contains(e.target))hideSpread();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!spreadPopup.hidden){e.preventDefault();dismissSpread();}});
window.addEventListener('resize',hideSpread);
document.addEventListener('scroll',e=>{if(!spreadPopup.contains(e.target))hideSpread();},true);
function closePicker(){$('champion-picker').close();picker=null;}
$('close-picker').onclick=closePicker;
dismissOnBackdrop($('champion-picker'),closePicker);
$('edit-pool').onclick=openPool;
$('close-pool').onclick=closePool;$('pool-done').onclick=closePool;
dismissOnBackdrop($('pool-picker'),closePool);
$('pool-picker').addEventListener('cancel',()=>{poolRole=null;});
$('pool-search').oninput=renderPool;
$('clear-pool').onclick=()=>{pools[poolRole]=[];persistPools();renderPool();update();};
$('champion-picker').addEventListener('cancel',()=>{picker=null;});
$('picker-search').oninput=renderPicker;
$('add-ban').onclick=()=>openPicker({ban:true});
$('candidate-search').oninput=renderRanking;
$('include-strength').onchange=()=>{includeStrength=$('include-strength').checked;update();};
document.querySelectorAll('[data-your-role]').forEach(button=>button.onclick=()=>{
 const role=button.dataset.yourRole;if(role===draft.role||datasetLoading)return;
 pauseForManualEdit();
 const preview=clientOwnChampion??selected;
 const blocked=[...Object.values(draft.allies),...Object.values(draft.enemies),...draft.bans];
 const result=selectDraftRole(draft,role,{preview:blocked.includes(preview)?null:preview,overrides:roleOverrides});
 draft=result.draft;roleOverrides=result.overrides;selected=result.selected;inheritedSelection=selected!=null;
 clientOwnChampion=null;clientHints={};clientRoleOverride=role;queuedClientSnapshot=null;
 $('candidate-search').value='';update();
});
$('auto-roles').onchange=()=>{autoRoles=$('auto-roles').checked;update();};
$('clear-role-pins').onclick=()=>{roleOverrides={allies:{},enemies:{}};update();};
$('reset').onclick=()=>{pauseForManualEdit();draft=emptyDraft(draft.role);roleOverrides={allies:{},enemies:{}};selected=null;inheritedSelection=false;clientOwnChampion=null;$('candidate-search').value='';update();};
function pauseForManualEdit(){
 if(companion&&clientSyncing)companion.pause();
}
function acceptClientSnapshot(snapshot){
 if(dragPress||$('role-mover').open){queuedClientSnapshot=snapshot;return;}
 const newSession=clientSession!==snapshot.sessionId;
 if(newSession)clientRoleOverride=null;
 try{
  const result=mergeClientSnapshot(draft,snapshot,champions,{overrides:roleOverrides,newSession,roleOverride:clientRoleOverride});
  draft=result.draft;roleOverrides=result.overrides;clientHints=result.hints;clientOwnChampion=result.ownChampion;clientSession=snapshot.sessionId;autoRoles=true;
  update();
  if(result.unknown.length)$('companion-status').textContent='Some champions are missing from this snapshot';
 }catch{$('companion-status').textContent='Draft could not be synced. Pause sync to enter picks manually.';}
}
function flushQueuedClient(){
 if(queuedClientSnapshot&&!dragPress&&!$('role-mover').open&&clientSyncing){const next=queuedClientSnapshot;queuedClientSnapshot=null;acceptClientSnapshot(next);}
}
async function loadDataset(id){
 const request=++datasetRevision;++revision;datasetLoading=true;hideSpread();
 renderTeamEdge();renderPoolBans();
 $('rank-dataset').disabled=true;
 $('breakdown').hidden=true;
 $('rankings').innerHTML='<div class="empty"><h3>Loading dataset…</h3></div>';
 $('edit-pool').disabled=true;$('ranking-context').textContent='Loading dataset…';
 try{
  const next=await datasets.catalog(id);if(request!==datasetRevision)return;
  const merged=new Map([...champions].map(([cid,c])=>[cid,{...c,roles:{}}]));
  for(const c of next.champions)merged.set(c.id,c);
  catalog=next;champions=merged;activeDataset=datasets.entry(id);profiles={};blindByRole={};graphCache={};ranking=null;datasetLoading=false;
  const date=new Date(catalog.asOf).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'});
  $('snapshot').textContent=`Snapshot · ${catalog.rank} · ${activeDataset.label} · ${date}`;
  $('data-details').textContent=`This ${catalog.rank} snapshot uses ${catalog.source} data for global ranked solo/duo. ${activeDataset.kind==='combined'?catalog.patches.length+' patches are combined by matchup game count.':'This snapshot covers a 30-day window.'} It covers ${catalog.champions.length} champions and ${Object.values(catalog.profileCounts).reduce((sum,n)=>sum+n,0)} champion-role profiles.`;
  const first=!loadDataset.initialized;
  if(first){restore();try{pools=loadPools(localStorage,champions);}catch{}loadDataset.initialized=true;}
  await update();
  if(first)companion=connectCompanion(state=>{
   clientSyncing=state.syncing;
   if(!state.enabled){queuedClientSnapshot=null;clientHints={};clientOwnChampion=null;}
   renderBoard();
   $('auto-roles').disabled=clientSyncing;
  },acceptClientSnapshot,companionSession);
 }catch(error){
  if(request!==datasetRevision)return;
  datasetLoading=false;
  if(activeDataset)await update();
  $('status').textContent=error.message;
 }finally{
  if(request===datasetRevision){
   $('rank-dataset').value=activeDataset?.id??datasets.defaultId;
   $('rank-dataset').disabled=false;
  }
 }
}
try{
 const response=await fetch('data/datasets.json',{cache:'no-store'});if(!response.ok)throw Error('Dataset index could not be loaded.');
 datasets=new DatasetStore(await response.json());
 const rankSelect=$('rank-dataset');
 for(const entry of datasets.entries.values()){
  if(entry.kind==='combined'&&entry.rank)rankSelect.add(new Option(entry.rank,entry.id));
 }
 rankSelect.hidden=rankSelect.options.length<2;
 rankSelect.value=datasets.defaultId;
 rankSelect.onchange=()=>loadDataset(rankSelect.value);
 await loadDataset(datasets.defaultId);
}catch(e){$('status').textContent=e.message;}
