export function connectCompanion(onState,onSnapshot){
 const token=new URLSearchParams(location.hash.slice(1)).get('companion');
 if(!token||location.hostname!=='127.0.0.1')return null;
 const bar=document.getElementById('companion-bar'),label=document.getElementById('companion-status'),toggle=document.getElementById('live-sync');
 bar.hidden=false;toggle.checked=true;document.querySelector('.brand').href=location.pathname+location.hash;
 let state=null,lastRevision=-1,stopped=false;
 const headers={'X-DraftLab-Session':token};
 const notify=()=>{
  const syncing=toggle.checked&&state?.status==='champ_select';
  label.textContent=toggle.checked?(state?.message??'Connecting to League…'):'Sync paused';
  onState({active:true,syncing,enabled:toggle.checked,status:state?.status});
  if(syncing&&state.snapshot)onSnapshot(state.snapshot);
 };
 toggle.onchange=notify;
 document.getElementById('quit-companion').onclick=async()=>{
  try{await fetch('/api/quit',{method:'POST',headers});}catch{}
  stopped=true;label.textContent='Companion closed';toggle.disabled=true;onState({active:true,syncing:false,enabled:false});
 };
 async function poll(){
  if(stopped)return;
  try{
   const response=await fetch('/api/state',{headers,cache:'no-store',signal:AbortSignal.timeout(3000)});
   if(!response.ok)throw Error('Companion unavailable');
   const next=await response.json();
   if(next.revision!==lastRevision){state=next;lastRevision=next.revision;notify();}
  }catch{
   label.textContent='Companion disconnected';onState({active:true,syncing:false,enabled:false});lastRevision=-1;
  }
  if(!stopped)setTimeout(poll,750);
 }
 poll();
 return {pause(){toggle.checked=false;notify();},resume(){toggle.checked=true;notify();}};
}
