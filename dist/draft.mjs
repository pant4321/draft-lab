import {ROLES,ROLE_NAMES,emptyDraft,rankDraft,validateDraft} from './draft-math.mjs';
import {roleBlindability} from './blindability.mjs';
import {inferDraftRoles,moveDraftChampion,cleanRoleOverrides} from './draft-roles.mjs';
import {mergeClientSnapshot,combineRoleHints} from './draft-sync.mjs';
import {connectCompanion} from './companion.mjs';
import {matchupSpreadGraph} from './matchup-spread.mjs';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=v=>(v>0?'+':'')+v.toFixed(2),tone=v=>v>.005?'positive':v<-.005?'negative':'zero';
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,''),num=n=>n.toLocaleString('en-US');
const STORAGE='draftlab-draft-v1';
let catalog,champions=new Map(),draft=emptyDraft(),profiles={},ranking=null,selected=null,includeStrength=false,picker=null,revision=0;
let autoRoles=false,roleOverrides={allies:{},enemies:{}},roleDetails={},dragging=null,dragPress=null,dragPreview=null,suppressDragClickUntil=0;
let companion=null,clientSyncing=false,clientHints={},clientOwnChampion=null,clientSession=null,clientRoleOverride=null,queuedClientSnapshot=null;
const roleRequests={};
const blindByRole={};
function champion(id){return champions.get(Number(id));}
function blindInfo(id){return blindByRole[draft.role]?.[id];}
function blindTitle(id){const b=blindInfo(id);return b?.score!=null?`Role-relative blindability: ${b.score}/100. Higher = more consistent across opponents and teammates. Estimated spread ${b.spread.toFixed(2)} pp; compared with ${b.comparedWith} ${ROLE_NAMES[draft.role].toLowerCase()} picks. Independent of this draft and its score.`:(b?.reason??'Not enough comparable role data.');}
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
 $('ban-chips').innerHTML=draft.bans.map(id=>`<button class="ban-chip" data-unban="${id}" aria-label="Unban ${esc(champion(id).name)}">${img(id,'')}<span>${esc(champion(id).name)} ×</span></button>`).join('');
 document.querySelectorAll('[data-unban]').forEach(b=>b.onclick=()=>{pauseForManualEdit();draft.bans=draft.bans.filter(id=>id!==+b.dataset.unban);update();});
}
function renderRanking(){
 hideSpread();
 if(!ranking?.ready){
  $('ranking-context').textContent='';
  $('rankings').innerHTML='<div class="empty"><div class="empty-icon">◈</div><p>Add champions on either side to see recommended champions</p></div>';
  $('ranking-footer').textContent='';$('breakdown').hidden=true;selected=null;renderBoard();return;
 }
 const allied=Object.values(draft.allies).filter(x=>x!=null).length,enemy=Object.values(draft.enemies).filter(x=>x!=null).length;
 $('ranking-context').textContent=`${ROLE_NAMES[draft.role]} · ${allied} ${allied===1?'ally':'allies'} · ${enemy} ${enemy===1?'enemy':'enemies'} revealed`;
 const query=norm($('candidate-search').value);
 const rows=ranking.ranked.map((row,index)=>({...row,index:index+1})).filter(row=>norm(champion(row.id).name).includes(query));
 $('rankings').innerHTML=rows.map(row=>`<div class="pick ${row.id===selected?'selected':''}"><button class="pick-inspect" data-candidate="${row.id}" aria-label="Inspect ${esc(champion(row.id).name)}, rank ${row.index}, draft edge ${signed(row.score)}"></button><span class="pick-lead"><span class="pick-rank">${row.index}</span>${img(row.id)}<span class="pick-name">${esc(champion(row.id).name)}<small>${(100*row.wr).toFixed(1)}% WR${row.smallSample?' · small samples':''}</small></span></span><span class="pick-pair ${tone(row.counter)}">${signed(row.counter)}</span><span class="pick-pair ${tone(row.synergy)}">${signed(row.synergy)}</span>${blindCell(row.id)}<span class="pick-total ${tone(row.score)}">${signed(row.score)}</span></div>`).join('')||'<div class="empty"><h3>No matching recommendations.</h3><p>Clear your search or change the draft.</p></div>';
 $('ranking-footer').textContent=`${ranking.ranked.length} ranked · ${ranking.shown}/${ranking.shown} revealed pairs covered`+(ranking.insufficient.length?` · ${ranking.insufficient.length} unranked for missing data`:'');
 document.querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>{selected=+b.dataset.candidate;renderRanking();renderBoard();renderBreakdown();});
}
function renderBreakdown(){
 const row=ranking?.ranked.find(x=>x.id===selected);
 $('breakdown').hidden=!row;if(!row)return;
 const c=champion(row.id);
 const cards=row.pairs.map(p=>`<article class="pair-card ${p.kind}"><div class="pair-title">${img(p.id,'')}<span><small>${p.kind==='enemy'?'VS':'WITH'} · ${ROLE_NAMES[p.role].toUpperCase()}</small>${esc(champion(p.id)?.name??p.id)}</span></div><div class="pair-value ${tone(p.adjusted)}">${signed(p.adjusted)}</div><p>${signed(p.raw)} pp raw · ${num(p.games)} games</p></article>`).join('');
 const base=includeStrength?`<article class="pair-card"><div class="pair-title">${img(row.id,'')}<span><small>BASE STRENGTH</small>${esc(c.name)}</span></div><div class="pair-value ${tone(row.base)}">${signed(row.base)}</div><p>${(row.wr*100).toFixed(2)}% overall WR vs 50%</p></article>`:'';
 $('breakdown').innerHTML=`<div class="breakdown-head"><div><h2>Why ${esc(c.name)}?</h2><p>Contribution from each revealed pick · sample-adjusted pp</p></div><div class="breakdown-numbers"><span class="blind-detail">Blindability ${blindCell(row.id)}</span><span class="breakdown-total ${tone(row.score)}">${signed(row.score)}</span></div></div><div class="pair-grid">${cards}${base}</div>`;
}
async function update(){
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
   if(!roleRequests[role])roleRequests[role]=fetch(`data/draft/${role}.json`).then(r=>{if(!r.ok)throw Error('Matchup data could not be loaded.');return r.json();}).then(d=>{if(!d.profiles)throw Error('Incomplete matchup data.');profiles[role]=d.profiles;return d;}).catch(e=>{delete roleRequests[role];throw e;});
   await roleRequests[role];
  }
  if(current!==revision)return;
  if(!blindByRole[draft.role]){
   blindByRole[draft.role]=roleBlindability(profiles[draft.role],catalog.champions);
  }
  ranking=rankDraft(draft,profiles[draft.role],{includeStrength});
  if(!ranking.ranked.some(x=>x.id===selected))selected=ranking.ranked[0]?.id??null;
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
 const values=[...champions.values()].filter(c=>norm(c.name).includes(query)).sort((a,b)=>(b.roles[role]?.pickRate??0)-(a.roles[role]?.pickRate??0)||a.name.localeCompare(b.name));
 $('picker-list').innerHTML=values.map(c=>{const banned=draft.bans.includes(c.id),disabled=taken.has(c.id)||(!picker.ban&&banned);return `<button class="champ-option ${banned?'banned':''}" data-pick="${c.id}" ${disabled?'disabled':''} aria-label="${picker.ban?(banned?'Unban ':'Ban '):'Pick '}${esc(c.name)}">${img(c.id,'')}<span>${esc(c.name)}</span></button>`;}).join('')||'<p>No champions found.</p>';
 document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
  const id=+b.dataset.pick;
  if(picker.ban){draft.bans=draft.bans.includes(id)?draft.bans.filter(x=>x!==id):[...draft.bans,id];update();renderPicker();$('picker-search').focus();}
  else{delete roleOverrides[picker.side][draft[picker.side][picker.role]];draft[picker.side][picker.role]=id;$('champion-picker').close();picker=null;update();}
 });
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
const graphCache={};
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
 spreadPopup.innerHTML=`<div class="spread-head"><h2 id="spread-title">${esc(c.name)} <span>· ${ROLE_NAMES[draft.role]}</span></h2><div class="spread-actions"><select id="spread-group" aria-label="Spread matchup group">${options}</select><button type="button" class="spread-close" aria-label="Close spread graph">×</button></div></div><div id="spread-chart"></div>`;
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
$('close-picker').onclick=()=>{$('champion-picker').close();picker=null;};
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
try{
 const response=await fetch('data/draft/catalog.json');if(!response.ok)throw Error('Champion data could not be loaded.');
 catalog=await response.json();champions=new Map(catalog.champions.map(c=>[c.id,c]));
 restore();$('snapshot').textContent='All ranks · 30 days · '+new Date(catalog.asOf).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'});
 $('data-details').textContent=`Frozen LoLalytics global ranked solo/duo snapshot. ${catalog.champions.length} champions and ${Object.values(catalog.profileCounts).reduce((s,n)=>s+n,0)} champion-role profiles. Candidate roles have at least 1,000 games and 0.25% of the listed role pool, or are the champion's primary role. Each profile retains its source URLs and hashes.`;
 await update();
 companion=connectCompanion(state=>{
  clientSyncing=state.syncing;
  if(!state.enabled){queuedClientSnapshot=null;clientHints={};clientOwnChampion=null;}
  $('auto-roles').disabled=clientSyncing;
 },acceptClientSnapshot);
}catch(e){$('status').textContent=e.message;}
