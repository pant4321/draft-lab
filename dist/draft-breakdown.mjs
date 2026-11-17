const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=value=>(value>0?'+':'')+value.toFixed(2);
const tone=value=>value>.005?'positive':value<-.005?'negative':'zero';
const roleNames={top:'Top',jungle:'Jungle',middle:'Mid',bottom:'Bot',support:'Support'};
const roleOrder=Object.keys(roleNames);
const count=games=>games>=1000?(games/1000).toFixed(1)+'k':String(games);

export function remainingCounterBreakdown(threats,{champion,portrait}){
 if(threats==null)return '';
 const cards=threats.map(threat=>{
  const name=escape(champion(threat.id)?.name??threat.id);
  const sample=threat.games.toLocaleString('en-US')+' games';
  return `<li class="remaining-counter">${portrait(threat.id)}
   <div class="remaining-counter-pick"><strong>${name}</strong><small>${roleNames[threat.role]} · ${threat.pickShare.toFixed(1)}% pick share</small></div>
   <span class="remaining-counter-effect negative" title="Sample-adjusted matchup effect from ${sample}">${signed(threat.adjusted)} pp</span>
  </li>`;
 }).join('');
 const details=cards?`<ul class="remaining-counter-list">${cards}</ul>`:'<p>No available common counters found in the matchup data.</p>';
 return `<section class="remaining-counters" aria-labelledby="remaining-counters-title">
  <div class="remaining-counters-head">
   <div class="remaining-counters-title">
    <h3 id="remaining-counters-title">Remaining counters</h3>
    <button type="button" class="remaining-counter-help" popovertarget="remaining-counter-method" aria-label="How remaining counters are ranked">?</button>
    <div id="remaining-counter-method" class="remaining-counter-method" popover>
     <p>We rank available picks by how common they are in their role, giving extra weight to tougher matchups.</p>
     <p>Cards show sample-adjusted effects. Minimum 5,000 matchup games and 0.5% role pick share.</p>
    </div>
   </div>
   ${cards?'<p>Ranked by matchup severity and role pick share</p>':''}
  </div>
  ${details}
 </section>`;
}

export function contributionBreakdown(row,{champion,portrait,includeStrength=false}={}){
 const card=pair=>{
  const name=champion(pair.id)?.name??String(pair.id),hasData=Number.isFinite(pair.raw)&&pair.games>0;
  const ignored=pair.multiplier===0,available=hasData&&Number.isFinite(pair.weighted);
  const value=ignored?'Ignored':available?signed(pair.weighted):'No data';
  const metadata=hasData?`<span title="Raw matchup delta: ${signed(pair.raw)} percentage points">${signed(pair.raw)} raw</span><span aria-hidden="true">·</span><span title="${pair.games.toLocaleString('en-US')} games" aria-label="${pair.games.toLocaleString('en-US')} games">${count(pair.games)} games</span>`:'<span>No data</span>';
  const weight=pair.multiplier!==1?`<p class="pair-weight">${ignored?'0× role weight':hasData?`${signed(pair.adjusted)} adjusted × ${pair.multiplier}`:`${pair.multiplier}× role weight`}</p>`:'';
  return `<article class="pair-card ${pair.kind}"><div class="pair-title">${portrait(pair.id)}<span><small>${roleNames[pair.role]}</small><span class="pair-champion" title="${escape(name)}">${escape(name)}</span></span></div><strong class="pair-value ${!ignored&&available?tone(pair.weighted):'zero'}${!available||ignored?' pair-unavailable':''}">${value}</strong><p class="pair-metadata">${metadata}</p>${weight}</article>`;
 };
 const group=(side,kind,title,subtotal)=>{
  const pairs=row.pairs.filter(pair=>pair.side===side).sort((a,b)=>roleOrder.indexOf(a.role)-roleOrder.indexOf(b.role));
  const missing=pairs.some(pair=>pair.multiplier!==0&&!Number.isFinite(pair.weighted));
  return `<section class="contribution-group ${kind}" aria-label="${title}"><div class="contribution-heading"><h3>${title}</h3><span>${kind==='ally'?'Synergy':'Counters'} <b class="${missing?'zero':tone(subtotal)}">${missing?'No data':signed(subtotal)}</b></span></div><div class="pair-grid" style="--pair-count:${Math.max(1,pairs.length)}">${pairs.map(card).join('')||`<p class="pair-empty">${kind==='ally'?'No teammates revealed':'No enemies revealed'}</p>`}</div></section>`;
 };
 const base=includeStrength?`<div class="breakdown-base"><span>Base strength</span><strong class="${tone(row.base)}">${signed(row.base)}</strong><small>${(row.wr*100).toFixed(2)}% overall WR vs 50%</small></div>`:'';
 const candidate=champion(row.id);
 return `<div class="breakdown-head"><div class="breakdown-identity">${portrait(row.id)}<h2>Why ${escape(candidate?.name??row.id)}?</h2></div><div class="breakdown-score"><span>Draft edge</span><strong class="breakdown-total ${row.complete===false?'zero':tone(row.score)}">${row.complete===false?'No data':signed(row.score)}</strong></div></div><p class="contribution-label">Adjusted contribution <span>pp</span></p><div class="contribution-groups">${group('allies','ally','With your team',row.synergy)}${group('enemies','enemy','Against the enemy',row.counter)}</div>${base}`;
}
