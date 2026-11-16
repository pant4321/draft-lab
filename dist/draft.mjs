import {ROLES,ROLE_NAMES,emptyDraft,validateDraft} from './draft-math.mjs?v=83c2e3d1ba0f';
import {recommendationList,sortPickerChampions} from './draft-list.mjs?v=08ffed6cfc9a';
import {roleBlindability} from './blindability.mjs?v=92f60cfcce68';
import {inferDraftRoles,moveDraftChampion,cleanRoleOverrides} from './draft-roles.mjs';
import {mergeClientSnapshot,combineRoleHints} from './draft-sync.mjs';
import {connectCompanion} from './companion.mjs?v=dccb644181f1';
import {prepareCompanionSession} from './companion-session.mjs?v=68364641f994';
import {startAnalytics} from './analytics.mjs?v=9d2db4435dc3';
import {matchupSpreadGraph} from './matchup-spread.mjs';
import {retainPopupFocus,dismissOnBackdrop} from './overlays.mjs';
import {emptyPools,loadPools,savePools,poolSections,prioritizePool} from './champion-pool.mjs';
import {DatasetStore} from './datasets.mjs?v=b605a99aaef9';
import {defaultMultipliers,loadMultipliers,saveMultipliers,customMultipliers} from './draft-weights.mjs?v=0465e432aded';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=v=>(v>0?'+':'')+v.toFixed(2),tone=v=>v>.005?'positive':v<-.005?'negative':'zero';
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,''),num=n=>n.toLocaleString('en-US');
const STORAGE='draftlab-draft-v1';
const companionSession=prepareCompanionSession();
startAnalytics();
let catalog,champions=new Map(),draft=emptyDraft(),profiles={},ranking=null,selected=null,includeStrength=false,picker=null,revision=0;
let autoRoles=false,roleOverrides={allies:{},enemies:{}},roleDetails={},dragging=null,dragPress=null,dragPreview=null,suppressDragClickUntil=0;
let companion=null,clientSyncing=false,clientHints={},clientOwnChampion=null,clientSession=null,clientRoleOverride=null,queuedClientSnapshot=null;
let pools=emptyPools(),poolRole=null;
let datasets,activeDataset=null,datasetLoading=true,datasetRevision=0;
let blindByRole={};
let multipliers=defaultMultipliers();try{multipliers=loadMultipliers(localStorage);}catch{}
function champion(id){return champions.get(Number(id));}
function blindInfo(id){return blindByRole[draft.role]?.[id];}
function blindTitle(id){const b=blindInfo(id);return b?.score!=null?`Counterpick safety: ${b.score}/100 among ${b.comparedWith} ${ROLE_NAMES[draft.role].toLowerCase()} picks. ${b.counterLoss.toFixed(2)} pp weighted downside across five enemy roles. Negative matchup deltas are sample-adjusted and multiplied by opponent role pick-rate share. Rare picks count less. Base WR, positive bonuses, and ally synergy do not affect this score. Independent of draft edge.`:(b?.reason??'Not enough comparable role data.');}
function blindCell(id){const b=blindInfo(id);return `<button type="button" data-blind="${id}" aria-haspopup="dialog" aria-expanded="false" aria-controls="blindability-popover" class="blind-score ${b?.score!=null?(b.score>=67?'blind-high':b.score<=33?'blind-low':'blind-mid'):'zero'}" aria-label="${esc(champion(id).name)} matchup WR delta spread. ${esc(blindTitle(id))}">${b?.score!=null?b.score+'<small>/100</small>':'—'}</button>`;}
function img(id,cls='portrait'){const c=champion(id);return c?`<img class="${cls}" draggable="false" src="assets/${esc(c.key)}.png" alt="">`:'';}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({draft,includeStrength,autoRoles,roleOverrides}));}catch{}}
function restore(){try{const value=JSON.parse(localStorage.getItem(STORAGE));if(value?.draft){validateDraft(value.draft);for(const id of [...Object.values(value.draft.allies),...Object.values(value.draft.enemies),...value.draft.bans])if(id!=null&&!champions.has(id))throw Error('Unknown saved champion.');draft=value.draft;includeStrength=!!value.includeStrength;autoRoles=!!value.autoRoles;roleOverrides=cleanRoleOverrides(draft,value.roleOverrides);}}catch{draft=emptyDraft();}}
function renderBoard(){
 for(const side of ['allies','enemies']) {
  $(side).innerHTML=ROLES.map(role=>{
   const own=side==='allies'&&role===draft.role;
   const id=own?(clientOwnChampion??selected):draft[side][role],c=champion(id),name=c?.name??(own?'':'Choose champion');
   const fixed=!own&&roleOverrides[side]?.[id]===role,guess=!own&&roleDetails[side]?.[id];
   const uncertain=guess&&!fixed&&(guess.unsupported||guess.alternatives.length);
   const hint=fixed?'Manual role. Auto roles will keep this correction.':uncertain?(guess.unsupported?'Limited role data. Drag to correct.':'Could also be '+guess.alternatives.map(r=>ROLE_NAMES[r]).join(' or ')+'. Drag to correct.'):'Drag to move; drop on a champion to swap roles.';
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
 $('clear-role-pins').hidden=!Object.values(roleOverrides).some(p=>Object.keys(p).length);
 $('your-role').value=draft.role;
 for(const option of $('your-role').options)option.disabled=draft.allies[option.value]!=null;
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
 $('score-label').hidden=blind;$('include-strength').disabled=blind;
 const query=norm($('candidate-search').value);
 const sections=poolSections(ranking.ranked,pools[draft.role]).map(section=>({...section,rows:section.rows
  .map((row,index)=>({...row,index:index+1})).filter(row=>norm(champion(row.id).name).includes(query))}));
 const hasRows=sections.some(section=>section.rows.length);
 $('rankings').innerHTML=sections.map(section=>{
  if(!section.rows.length)return section.key==='pool'&&!query?'<h2 class="ranking-group">Your pool</h2><p class="pool-unavailable">None available for this draft.</p>':'';
  const heading=section.title?`<h2 class="ranking-group">${section.title} <span>${section.rows.length}</span></h2>`:'';
  return heading+section.rows.map(row=>`<div class="pick ${row.id===selected?'selected':''}" data-pool-group="${section.key}"><button class="pick-inspect" data-candidate="${row.id}" aria-label="Inspect ${esc(champion(row.id).name)}, rank ${row.index}${section.title?' in '+section.title.toLowerCase():''}${blind?'':', draft edge '+signed(row.score)}"></button><span class="pick-lead"><span class="pick-rank">${row.index}</span>${img(row.id)}<span class="pick-name">${esc(champion(row.id).name)}<small>${(100*row.wr).toFixed(1)}% WR${row.smallSample?' · small samples':''}</small></span></span><span class="pick-pair ${blind?'zero':tone(row.counter)}">${blind?'—':signed(row.counter)}</span><span class="pick-pair ${blind?'zero':tone(row.synergy)}">${blind?'—':signed(row.synergy)}</span>${blindCell(row.id)}<span class="pick-total ${blind?'zero':tone(row.score)}">${blind?'—':signed(row.score)}</span></div>`).join('');
 }).join('')+(!hasRows?'<div class="empty"><h3>No matching recommendations.</h3><p>Clear your search or change the draft.</p></div>':'');
 const active=ranking.shown-ranking.ignored;
 $('ranking-footer').textContent=blind?`${ranking.ranked.length} champions · Highest blindability first`:`${ranking.ranked.length} ranked · ${active}/${active} ${ranking.ignored?'active':'revealed'} pairs covered${ranking.ignored?' · '+ranking.ignored+' ignored':''}`+(ranking.insufficient.length?` · ${ranking.insufficient.length} unranked for missing data`:'');
 document.querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>{selected=+b.dataset.candidate;renderRanking();renderBoard();renderBreakdown();});
}
function renderBreakdown(){
 const row=ranking?.ranked.find(x=>x.id===selected);
 $('breakdown').hidden=!row;if(!row)return;
 const c=champion(row.id);
 if(ranking.mode==='blindability'){
  const info=blindInfo(row.id);
  $('breakdown').innerHTML=`<div class="breakdown-head"><div><h2>${esc(c.name)}</h2><p>${(100*row.wr).toFixed(1)}% WR · ${info?.counterLoss!=null?info.counterLoss.toFixed(2)+' pp weighted downside':'Downside unavailable'}</p></div><span class="blind-detail">Blindability ${blindCell(row.id)}</span></div>`;
  return;
 }
 const cards=row.pairs.map(p=>`<article class="pair-card ${p.kind}"><div class="pair-title">${img(p.id,'')}<span><small>${p.kind==='enemy'?'VS':'WITH'} · ${ROLE_NAMES[p.role].toUpperCase()}</small>${esc(champion(p.id)?.name??p.id)}</span></div><div class="pair-value ${tone(p.weighted)}">${signed(p.weighted)}</div><p>${p.multiplier!==1?(p.multiplier===0?'Ignored · 0×':signed(p.adjusted)+' pp adjusted × '+p.multiplier)+'<br>':''}${p.raw==null?'No saved matchup':signed(p.raw)+' pp raw · '+num(p.games)+' games'}</p></article>`).join('');
 const base=includeStrength?`<article class="pair-card"><div class="pair-title">${img(row.id,'')}<span><small>BASE STRENGTH</small>${esc(c.name)}</span></div><div class="pair-value ${tone(row.base)}">${signed(row.base)}</div><p>${(row.wr*100).toFixed(2)}% overall WR vs 50%</p></article>`:'';
 $('breakdown').innerHTML=`<div class="breakdown-head"><div><h2>Why ${esc(c.name)}?</h2><p>Contribution from each revealed pick · sample-adjusted pp</p></div><div class="breakdown-numbers"><span class="blind-detail">Blindability ${blindCell(row.id)}</span><span class="breakdown-total ${tone(row.score)}">${signed(row.score)}</span></div></div><div class="pair-grid">${cards}${base}</div>`;
}
async function update(){
 if(datasetLoading)return;
 clearDrag();hideSpread();const current=++revision;$('status').textContent='';
 try{
  roleOverrides=cleanRoleOverrides(draft,roleOverrides);roleDetails={};
  if(autoRoles){const guess=inferDraftRoles(draft,champions,combineRoleHints(draft,roleOverrides,clientHints));draft=guess.draft;roleDetails=guess.details;}
  persist();renderBoard();
  if(!profiles[draft.role]){
   ranking=null;selected=null;$('breakdown').hidden=true;$('ranking-footer').textContent='';
   $('ranking-context').textContent='Loading '+ROLE_NAMES[draft.role].toLowerCase()+' pairs…';
   $('rankings').innerHTML='<div class="empty"><h3>Loading '+ROLE_NAMES[draft.role].toLowerCase()+' matchups…</h3></div>';
   const role=draft.role;
   const datasetId=activeDataset.id;
   const loaded=await datasets.role(datasetId,role);
   if(current!==revision||activeDataset.id!==datasetId)return;
   profiles[role]=loaded;
  }
  if(current!==revision)return;
  if(!blindByRole[draft.role]){
   blindByRole[draft.role]=roleBlindability(profiles[draft.role],catalog.champions);
  }
  ranking=recommendationList(draft,profiles[draft.role],blindByRole[draft.role],champions,{includeStrength,multipliers});
  ranking={...ranking,ranked:prioritizePool(ranking.ranked,pools[draft.role])};
  if(!ranking.ranked.some(x=>x.id===selected))selected=ranking.mode==='blindability'?null:ranking.ranked[0]?.id??null;
  renderRanking();renderBoard();renderBreakdown();
 }catch(e){if(current===revision){$('status').textContent=e.message;$('rankings').innerHTML='<div class="empty"><h3>Data unavailable.</h3><p>Try selecting your role again.</p></div>';$('breakdown').hidden=true;}}
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
$('your-role').onchange=()=>{const role=$('your-role').value;if(draft.allies[role]!=null){$('your-role').value=draft.role;return;}draft.role=role;if(clientSyncing)clientRoleOverride=role;selected=null;update();};
$('auto-roles').onchange=()=>{autoRoles=$('auto-roles').checked;update();};
$('clear-role-pins').onclick=()=>{roleOverrides={allies:{},enemies:{}};update();};
$('reset').onclick=()=>{pauseForManualEdit();draft=emptyDraft(draft.role);roleOverrides={allies:{},enemies:{}};selected=null;$('candidate-search').value='';update();};
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
 $('dataset-select').disabled=true;
 $('edit-pool').disabled=true;$('ranking-context').textContent='Loading dataset…';
 try{
  const next=await datasets.catalog(id);if(request!==datasetRevision)return;
  const merged=new Map([...champions].map(([cid,c])=>[cid,{...c,roles:{}}]));
  for(const c of next.champions)merged.set(c.id,c);
  catalog=next;champions=merged;activeDataset=datasets.entry(id);profiles={};blindByRole={};graphCache={};ranking=null;datasetLoading=false;
  $('dataset-select').value=id;
  try{localStorage.setItem('draftlab-dataset-v1',id);}catch{}
  const date=new Date(catalog.asOf).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'});
  $('snapshot').textContent=`All ranks · ${activeDataset.kind==='combined'?activeDataset.label:'30-day history'} · ${date}`;
  $('data-details').textContent=`Frozen LoLalytics global ranked solo/duo snapshot. ${activeDataset.kind==='combined'?catalog.patches.length+' discrete patches combined by pair game counts.':'Original 30-day snapshot preserved separately.'} ${catalog.champions.length} champions and ${Object.values(catalog.profileCounts).reduce((sum,n)=>sum+n,0)} champion-role profiles. Missing patch pairs are not invented. Component snapshots retain their source URLs and hashes.`;
  const first=!loadDataset.initialized;
  if(first){restore();try{pools=loadPools(localStorage,champions);}catch{}loadDataset.initialized=true;}
  await update();
  if(first)companion=connectCompanion(state=>{
   clientSyncing=state.syncing;
   if(!state.enabled){queuedClientSnapshot=null;clientHints={};clientOwnChampion=null;}
   $('auto-roles').disabled=clientSyncing;
  },acceptClientSnapshot,companionSession);
 }catch(error){
  if(request!==datasetRevision)return;
  datasetLoading=false;
  if(activeDataset){$('dataset-select').value=activeDataset.id;await update();}
  $('status').textContent=error.message;
 }finally{if(request===datasetRevision)$('dataset-select').disabled=false;}
}
$('dataset-select').onchange=()=>loadDataset($('dataset-select').value);
try{
 const response=await fetch('data/datasets.json',{cache:'no-store'});if(!response.ok)throw Error('Dataset index could not be loaded.');
 datasets=new DatasetStore(await response.json());
 $('dataset-select').innerHTML=[...datasets.entries.values()].map(entry=>`<option value="${esc(entry.id)}">${esc(entry.label)}</option>`).join('');
 $('dataset-select').disabled=false;
 let datasetId=datasets.defaultId;try{const saved=localStorage.getItem('draftlab-dataset-v1');if(datasets.entries.has(saved))datasetId=saved;}catch{}
 if(datasetId!==datasets.defaultId){
  const latest=await datasets.catalog(datasets.defaultId);
  champions=new Map(latest.champions.map(c=>[c.id,{...c,roles:{}}]));
 }
 await loadDataset(datasetId);
}catch(e){$('status').textContent=e.message;}
