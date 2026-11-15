const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=n=>(n>0?'+':'')+n.toFixed(2);

// Preserve exact delta positions; move portraits vertically only to avoid overlap.
export function stackMatchups(rows) {
 const width=600,left=18,right=582,top=12,size=18,gap=3;
 const bound=Math.max(6,Math.ceil(Math.max(...rows.map(r=>Math.abs(r.delta)))+.5));
 const x=v=>left+(v+bound)/(2*bound)*(right-left);
 const levels=[],points=[];
 for(const row of [...rows].sort((a,b)=>a.delta-b.delta||a.id-b.id)){
  const cx=x(row.delta);
  let level=levels.findIndex(xs=>xs.every(px=>Math.abs(px-cx)>=size+gap));
  if(level<0){level=levels.length;levels.push([]);}
  levels[level].push(cx);points.push({...row,cx,level});
 }
 const baseline=Math.max(235,levels.length*(size+gap)+54),height=baseline+49;
 return {points,width,left,right,top,size,gap,bound,baseline,height};
}

export function matchupSpreadGraph(estimate,champions,selectedId,kind,role) {
 const group=estimate?.groups.find(g=>g.kind===kind&&g.role===role),c=champions.get(selectedId);
 if(!group?.resolved||!group.rows?.length)return '<p class="spread-unavailable">Not enough common matchup data for this role.</p>';
 const layout=stackMatchups(group.rows),{points,width,left,right,top,size,bound,baseline,height}=layout;
 const x=v=>left+(v+bound)/(2*bound)*(right-left);
 const sigma=group.trueVariance>0?Math.sqrt(group.trueVariance):null;
 const peak=(baseline-top)*.56;
 const path=sigma?Array.from({length:241},(_,i)=>{
  const v=-bound+2*bound*i/240,y=baseline-peak*Math.exp(-.5*((v-group.mean)/sigma)**2);
  return `${i?'L':'M'}${x(v).toFixed(2)},${y.toFixed(2)}`;
 }).join(' '):null;
 const label=`${c.name} true spread ${sigma==null?'unresolved':sigma.toFixed(1)+' pp'}`;
 const badgeWidth=Math.min(width-50,Math.max(180,label.length*7+35));
 const gradient=`spread-field-${selectedId}-${kind}-${role}`;
 const ticks=Array.from({length:Math.floor(bound/2)*2+1},(_,i)=>2*(i-Math.floor(bound/2)));
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(c.name)} ${kind==='enemy'?'opponent':'teammate'} win-rate delta spread. ${points.length} champion icons. ${sigma==null?'True spread is unresolved.':'Estimated true spread '+sigma.toFixed(2)+' percentage points.'} Dashed line at minus 2 percentage points.">
 <defs><linearGradient id="${gradient}"><stop stop-color="#71333e" stop-opacity=".46"/><stop offset=".5" stop-color="#141b1d"/><stop offset="1" stop-color="#39634d" stop-opacity=".5"/></linearGradient></defs>
 <rect x="${left}" y="${top}" width="${right-left}" height="${baseline-top}" fill="url(#${gradient})"/>
 <line class="spread-zero" x1="${x(0)}" x2="${x(0)}" y1="${top}" y2="${baseline}"/>
 <line class="spread-cutoff" x1="${x(-2)}" x2="${x(-2)}" y1="${top}" y2="${baseline}"/>
 ${path?`<path class="spread-curve" d="${path}"/>`:''}
 <line class="spread-axis" x1="${left}" x2="${right}" y1="${baseline}" y2="${baseline}"/>
 ${ticks.map(v=>`<text x="${x(v)}" y="${baseline+20}" text-anchor="middle">${v>0?'+':''}${v}</text>`).join('')}
 <text class="spread-axis-label" x="${width/2}" y="${height-7}" text-anchor="middle">WR delta above expected · percentage points</text>
 ${points.map(p=>{
  const champ=champions.get(p.id),px=p.cx-size/2,py=baseline-size-3-p.level*(size+3);
  return `<g class="spread-champion" data-spread-champion="${p.id}" data-delta="${p.delta}"><title>${kind==='enemy'?'vs':'with'} ${esc(champ.name)} · ${signed(p.delta)} pp · ${p.n.toLocaleString('en-US')} games</title><image href="assets/${esc(champ.key)}.png" x="${px}" y="${py}" width="${size}" height="${size}"/><rect x="${px}" y="${py}" width="${size}" height="${size}" rx="1"/></g>`;
 }).join('')}
 <g class="spread-badge"><rect x="${right-badgeWidth-8}" y="${top+9}" width="${badgeWidth}" height="28" rx="2"/><image href="assets/${esc(c.key)}.png" x="${right-badgeWidth}" y="${top+14}" width="18" height="18"/><text x="${right-badgeWidth+25}" y="${top+28}">${esc(label)}</text></g>
 </svg>`;
}
