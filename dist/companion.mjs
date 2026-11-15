import {forgetCompanionSession,loopbackPermission} from './companion-session.mjs?v=68364641f994';

export function connectCompanion(onState,onSnapshot,session,environment=globalThis){
 if(!session)return null;
 const {document,navigator}=environment,$=id=>document.getElementById(id);
 const bar=$('companion-bar'),label=$('companion-status'),toggle=$('live-sync'),button=$('connect-companion'),quit=$('quit-companion');
 bar.hidden=false;toggle.checked=true;toggle.disabled=true;quit.disabled=true;
 let state=null,lastRevision=-1,stopped=false,busy=false,timer=null,permission=null,connected=false;
 const headers={'X-DraftLab-Session':session.token};
 const notify=()=>{
  const syncing=connected&&toggle.checked&&state?.status==='champ_select';
  label.textContent=toggle.checked?(state?.message??'Connecting to League…'):'Sync paused';
  onState({active:true,syncing,enabled:connected&&toggle.checked,status:state?.status});
  if(syncing&&state.snapshot)onSnapshot(state.snapshot);
 };
 const waiting=()=>{
  connected=false;toggle.disabled=true;quit.disabled=true;button.hidden=false;button.disabled=false;
  button.textContent='Connect to League';
  label.textContent=permission?.state==='denied'?'Allow local companion access in your browser’s site settings, then reconnect.':'Connect to allow this page to read champion select from your companion.';
  onState({active:true,syncing:false,enabled:false});
 };
 const request=(path,options={})=>environment.fetch(session.origin+path,{
  mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',targetAddressSpace:'loopback',
  signal:AbortSignal.timeout(10000),...options,headers
 });
 async function poll(){
  if(stopped||busy)return;
  if(timer!=null){environment.clearTimeout(timer);timer=null;}
  busy=true;button.disabled=true;
  try{
   const response=await request('/api/state');
   if(response.status===403){forgetCompanionSession(environment);throw Error('session');}
   if(!response.ok)throw Error('connection');
   const next=await response.json();
   if(next.bridgeProtocol!==1)throw Error('version');
   if(stopped)return;
   connected=true;toggle.disabled=false;quit.disabled=false;button.hidden=true;
   if(next.revision!==lastRevision){state=next;lastRevision=next.revision;notify();}
   timer=environment.setTimeout(poll,750);
  }catch(error){
   if(stopped)return;
   const wasConnected=connected;waiting();button.textContent='Reconnect';lastRevision=-1;
   label.textContent=error.message==='session'?'Companion session expired. Open Draft Lab from its launcher again.':error.message==='version'?'Update the companion to connect to this website.':permission?.state==='denied'?'Allow local companion access in your browser’s site settings, then reconnect.':'Companion unavailable. Keep it running and allow local access when your browser asks.';
   if(wasConnected&&permission?.state!=='denied'&&!['session','version'].includes(error.message))timer=environment.setTimeout(poll,3000);
  }finally{busy=false;button.disabled=false;}
 }
 toggle.onchange=notify;
 button.onclick=()=>{label.textContent='Connecting to League…';return poll();};
 quit.onclick=async()=>{
  quit.disabled=true;
  try{
   const response=await request('/api/quit',{method:'POST'});if(!response.ok)throw Error();
   stopped=true;if(timer!=null)environment.clearTimeout(timer);forgetCompanionSession(environment);
   label.textContent='Companion closed';toggle.disabled=true;button.hidden=true;
   onState({active:true,syncing:false,enabled:false});
  }catch{quit.disabled=false;label.textContent='Could not close the companion. Use Quit in its launcher.';}
 };
 waiting();
 loopbackPermission(navigator).then(status=>{
  if(stopped)return;permission=status;
  if(status){
   status.addEventListener('change',()=>{
    if(status.state==='granted')poll();
    else{if(timer!=null)environment.clearTimeout(timer);timer=null;waiting();}
   });
  }
  if(status?.state==='granted')poll();
  else if(!busy&&!connected)waiting();
 });
 return {pause(){toggle.checked=false;notify();},resume(){toggle.checked=true;notify();}};
}
