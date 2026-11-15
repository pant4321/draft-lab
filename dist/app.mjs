import {analyze,validate} from './stats.mjs';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=p=>(100*p).toFixed(2)+'%',pp=p=>(p>0?'+':'')+p.toFixed(2),num=n=>n.toLocaleString('en-US');
let data,result,selected,datasets={},loadNumber=0;
const options=()=>({floor:+$('floor').value,minGames:+$('minGames').value,weighted:$('weight').value==='meta',threshold:+$('threshold').value});
const portrait=r=>/^[A-Za-z0-9]+$/.test(r.id??'')?r.id:'Qiyana';
function draw(){
 $('floorOut').textContent=(+$('floor').value).toFixed(1)+'%';
 result=analyze(data,options());
 $('csv').disabled=!result;
 if(!result){$('chart').textContent='No matchups meet these filters.';$('rows').replaceChildren();$('coverage').textContent='';$('count').textContent='0';$('true').textContent='—';$('status').textContent='Lower the minimum pick rate or games.';$('detail').textContent='';return;}
 const r=result;
 $('true').textContent=r.sigma>0?r.sigma.toFixed(2)+' pp':'Unresolved';
 $('count').textContent=r.rows.length;
 $('coverage').textContent=r.rows.length+' matchups · '+num(r.games)+' games';
 $('refLegend').hidden=!$('reference').checked;
 $('trueLegend').hidden=r.sigma<=0;
 $('status').textContent=r.sigma>0?'':'Not enough signal to estimate true spread in this sample.';
 graph();table();
 inspect(r.rows.some(x=>x.champion===selected)?selected:r.rows.reduce((a,b)=>a.delta<b.delta?a:b).champion);
}
function graph(){
 const r=result,W=900,L=38,R=22,T=28,size=25,gap=3;
 const bound=Math.max(6,Math.ceil(Math.max(...r.rows.map(x=>Math.abs(x.delta)))+.35));
 const x=v=>L+(v+bound)/(2*bound)*(W-L-R);
 const levels=[],positions=[];
 for(const row of [...r.rows].sort((a,b)=>a.delta-b.delta)){
  const cx=x(row.delta);let level=levels.findIndex(xs=>xs.every(px=>Math.abs(px-cx)>=size+gap));
  if(level<0){level=levels.length;levels.push([]);}levels[level].push(cx);positions.push({row,cx,level});
 }
 const B=Math.max(285,levels.length*(size+gap)+45),H=B+58;
 const y=(v,mu,s)=>B-185*Math.exp(-.5*((v-mu)/s)**2);
 const path=(mu,s)=>Array.from({length:241},(_,i)=>{const v=-bound+2*bound*i/240;return (i?'L':'M')+x(v).toFixed(2)+','+y(v,mu,s).toFixed(2)}).join(' ');
 const cut=x(options().threshold),zero=x(0);
 let content=`<defs><linearGradient id="field"><stop stop-color="#a54b64" stop-opacity=".20"/><stop offset=".5" stop-color="#1c2928"/><stop offset="1" stop-color="#679f7c" stop-opacity=".15"/></linearGradient></defs><rect x="${L}" y="${T}" width="${W-L-R}" height="${B-T}" fill="url(#field)"/><rect x="${L}" y="${T}" width="${cut-L}" height="${B-T}" fill="#b65068" opacity=".10"/><line x1="${zero}" x2="${zero}" y1="${T}" y2="${B}" stroke="#51625b"/><line x1="${cut}" x2="${cut}" y1="${T}" y2="${B}" stroke="#d995a1" stroke-dasharray="4 5"/>`;
 if($('reference').checked)content+=`<path d="${path(0,1.1)}" fill="none" stroke="#e6c98c" stroke-dasharray="5 5" stroke-width="1.5" opacity=".8"/>`;
 if(r.sigma>0)content+=`<path d="${path(r.mean,r.sigma)}" fill="none" stroke="#d5efda" stroke-width="2.5"/>`;
 content+=`<line x1="${L}" x2="${W-R}" y1="${B}" y2="${B}" stroke="#687b74"/>`;
 for(let i=-bound;i<=bound;i++)content+=`<text x="${x(i)}" y="${B+23}" text-anchor="middle" fill="#9eafb1" font-size="12">${i>0?'+':''}${i}</text>`;
 content+=`<text x="${W/2}" y="${H-9}" text-anchor="middle" fill="#9eafb1" font-size="12">Win rate above expected · percentage points</text>`;
 for(const {row,cx,level} of positions){
  const px=cx-size/2,py=B-size-3-level*(size+gap);
  content+=`<g class="point" tabindex="0" role="button" data-name="${esc(row.champion)}" aria-label="${esc(row.champion)}: ${pp(row.delta)} percentage points"><title>${esc(row.champion)} · ${pp(row.delta)} pp · ${num(row.games)} games</title><image href="assets/${portrait(row)}.png" x="${px}" y="${py}" width="${size}" height="${size}"/><rect x="${px}" y="${py}" width="${size}" height="${size}" fill="transparent" stroke="${row.delta<options().threshold?'#d995a1':'#698a78'}" rx="2"/></g>`;
 }
 $('chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Qiyana matchup advantages">${content}</svg>`;
 $('chart').querySelectorAll('.point').forEach(el=>{el.onclick=()=>inspect(el.dataset.name);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect(el.dataset.name);}};});
}
function table(){
 const rows=result.rows.filter(r=>r.champion.toLowerCase().includes($('search').value.toLowerCase())).sort((a,b)=>a.delta-b.delta);
 $('rows').innerHTML=rows.map(r=>`<tr tabindex="0" data-name="${esc(r.champion)}"><td><img src="assets/${portrait(r)}.png" alt="">${esc(r.champion)}</td><td class="${r.delta>=0?'positive':'negative'}">${pp(r.delta)} pp</td><td>${pct(r.observedWr)}</td><td>${num(r.games)}</td></tr>`).join('')||'<tr><td colspan="4">No matching champions.</td></tr>';
 $('rows').querySelectorAll('tr[data-name]').forEach(el=>{el.onclick=()=>inspect(el.dataset.name);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect(el.dataset.name);}};});
}
function inspect(name){
 selected=name;const r=result.rows.find(r=>r.champion===name);if(!r)return;
 $('detail').innerHTML=`<b>vs ${esc(r.champion)}</b> &nbsp; <span class="${r.delta>=0?'positive':'negative'}">${pp(r.delta)} pp</span><span class="sub">${pct(r.observedWr)} win rate · ${pct(r.expectedWr)} expected · 95% interval ${pp(r.ci[0])} to ${pp(r.ci[1])} pp</span>`;
 $('rows').querySelectorAll('tr').forEach(el=>el.classList.toggle('selected',el.dataset.name===name));
 $('chart').querySelectorAll('.point').forEach(el=>el.classList.toggle('selected',el.dataset.name===name));
}
function provenance(){
 const date=data.collectedAt?new Date(data.collectedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'}):'Custom snapshot';
 $('cohort').textContent='30 days · '+date;
 $('provenance').textContent=`${data.rank??'Custom'} · Global · Ranked solo/duo. ${num(data.qiyanaGames??0)} Qiyana games. Independent LoLalytics snapshot; ${data.rows.length} available matchup rows.`;
 $('sources').replaceChildren(...(data.sources??[]).filter(s=>{try{return ['https:','http:'].includes(new URL(s.url).protocol)}catch{return false}}).map((s,i)=>{const a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noreferrer';a.textContent=['Matchups ↗','Qiyana baseline ↗','Mid pick rates ↗'][i]??'Source ↗';return a;}));
}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
for(const id of ['floor','minGames','weight','threshold','reference'])$(id).addEventListener('input',()=>{if(data)draw();});
$('search').addEventListener('input',()=>{if(result){table();inspect(selected);}});
$('json').onclick=()=>download('qiyana-snapshot.json',JSON.stringify(data,null,2),'application/json');
$('csv').onclick=()=>{if(!result)return;const cell=x=>'"'+String(x).replaceAll('"','""')+'"';const headers=['opponent','games','observed_wr_pct','expected_wr_pct','edge_pp','ci_low_pp','ci_high_pp','role_pick_rate_pct','normalized_weight'];const lines=result.rows.map(r=>[r.champion,r.games,100*r.observedWr,100*r.expectedWr,r.delta,...r.ci,r.pickRate,r.weight].map(cell).join(','));download('qiyana-matchups.csv',[headers.join(','),...lines].join('\r\n'),'text/csv');};
$('upload').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>2_000_000)throw Error('Use a JSON file under 2 MB.');const next=validate(JSON.parse(await f.text()));if(next.pickRateUnit!=='percent_of_listed_role_games')throw Error('Use a current snapshot with role pick rates.');data=next;loadNumber++;if(!$('rank').querySelector('[value="custom"]'))$('rank').add(new Option('Custom','custom'));$('rank').value='custom';selected=null;provenance();draw();}catch(err){$('status').textContent='Could not load: '+err.message;}finally{e.target.value='';}};
async function loadRank(){
 const version=++loadNumber,key=$('rank').value;if(key==='custom')return;
 try{if(!datasets[key]){const response=await fetch(key==='all'?'data/qiyana.json':'data/qiyana-diamond.json');if(!response.ok)throw Error('Data request failed.');datasets[key]=validate(await response.json());}if(version!==loadNumber)return;data=datasets[key];selected=null;$('search').value='';provenance();draw();}catch(e){$('status').textContent='Unable to load sample: '+e.message;}
}
$('rank').onchange=loadRank;
$('reset').onclick=()=>{$('rank').value='all';$('floor').value='.5';$('minGames').value='100';$('weight').value='meta';$('threshold').value='-2';$('reference').checked=false;$('search').value='';selected=null;loadRank();};
await loadRank();
