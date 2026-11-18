import {pairContribution} from './draft-math.mjs?v=83c2e3d1ba0f';

const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=value=>(value>0?'+':'')+value.toFixed(2);
const tone=value=>value>.005?'positive':value<-.005?'negative':'zero';
const roleNames={top:'Top',jungle:'Jungle',middle:'Mid',bottom:'Bot',support:'Support'};
const roleOrder=Object.keys(roleNames);
const count=games=>games>=1000?(games/1000).toFixed(1)+'k':String(games);
const priority=value=>value===0?'0':value<.001?'&lt;0.001':value.toFixed(3);

export function remainingCounterCards(threats,{champion,portrait}){
 if(threats==null)return '';
 const cards=threats.map(threat=>{
  const name=escape(champion(threat.id)?.name??threat.id);
  const sample=threat.games.toLocaleString('en-US')+' games';
  return `<li class="remaining-counter">${portrait(threat.id)}
   <div class="remaining-counter-pick"><strong>${name}</strong><small>${roleNames[threat.role]} · ${threat.pickShare.toFixed(1)}% pick share</small></div>
   <span class="remaining-counter-effect negative" title="Sample-adjusted matchup effect from ${sample}">${signed(threat.adjusted)} pp</span>
  </li>`;
 }).join('');
 return cards?`<ul class="remaining-counter-list">${cards}</ul>`:'<p>No available common counters found in the matchup data.</p>';
}

export function poolBanList(threats,{champion,portrait,hasPool}){
 if(!threats?.length){
  return hasPool?'<p>No bans to suggest for this pool.</p>':'<p>Add champions to <strong>Your pool</strong> to get suggestions.</p>';
 }
 const rows=threats.map(({id,role,pickShare,affected,poolSize,worst,contributions,risk})=>{
  const opponent=escape(champion(id)?.name??id),poolPick=escape(champion(worst.id)?.name??worst.id);
  const sample=worst.games.toLocaleString('en-US')+' games';
  const matchups=contributions.map(matchup=>{
   const name=escape(champion(matchup.id)?.name??matchup.id),games=matchup.games.toLocaleString('en-US');
   return `<tr><th scope="row">${name}</th><td class="${tone(matchup.adjusted)}" title="Sample-adjusted effect from ${games} games">${signed(matchup.adjusted)} pp</td><td>${priority(matchup.priority)}</td></tr>`;
  }).join('');
  return `<li><details name="pool-ban-matchups" data-pool-ban-id="${id}">
   <summary class="pool-ban-entry">${portrait(id)}<span class="pool-ban-details">
    <span class="pool-ban-summary"><strong>${opponent}</strong><small>${roleNames[role]} · ${pickShare.toFixed(1)}% pick share</small></span>
    <span class="pool-ban-impact"><span>Hurts ${affected} of ${poolSize} pool picks</span>
     <span>Hardest on ${poolPick} <strong class="negative" title="Sample-adjusted effect from ${sample}">${signed(worst.adjusted)} pp</strong></span>
    </span>
   </span></summary>
   <table class="pool-ban-table" aria-label="Pool matchups against ${opponent}">
    <thead><tr><th scope="col">Pool pick</th><th scope="col">Matchup</th><th scope="col">Ban score</th></tr></thead>
    <tbody>${matchups}</tbody>
    <tfoot><tr><th scope="row" colspan="2">Total ban score</th><td>${priority(risk)}</td></tr></tfoot>
   </table>
  </details></li>`;
 });
 return `<p class="pool-ban-note">Pool picks count equally. Open a suggestion to see each matchup.</p><ol class="pool-ban-list">${rows.join('')}</ol>`;
}

export function samplingRange(pair){
 const [delta,games,observed]=pair??[];
 if(!Number.isFinite(delta)||!Number.isInteger(games)||games<=0||!Number.isFinite(observed)||observed<0||observed>1)return null;
 const expected=observed-delta/100;
 if(expected<0||expected>1)return null;
 // Wilson interval for the observed rate, shifted by the fixed expected rate.
 const z=1.96,scale=1+z*z/games;
 const center=(observed+z*z/(2*games))/scale;
 const radius=z*Math.sqrt(observed*(1-observed)/games+z*z/(4*games*games))/scale;
 return [100*(Math.max(0,center-radius)-expected),100*(Math.min(1,center+radius)-expected)];
}

function contributionSamplingRange(pair,profile){
 if(!Number.isFinite(pair.weighted))return null;
 const rawRange=samplingRange(profile?.[pair.kind]?.[pair.role]?.[pair.id]);
 return rawRange?.map(delta=>pairContribution([delta,pair.games]).adjusted*pair.multiplier);
}

export function draftSamplingOffsets(row,profile){
 const pairs=row.pairs.filter(pair=>pair.multiplier>0);
 if(!row.complete||!pairs.length)return null;
 let down=0,up=0;
 for(const pair of pairs){
  const range=contributionSamplingRange(pair,profile);
  if(!range)return null;
  down+=pair.weighted-range[0];
  up+=range[1]-pair.weighted;
 }
 // Let the matchup estimates move together to their low or high bounds.
 return {down:Math.max(0,down),up:Math.max(0,up)};
}

export function contributionBreakdown(row,{champion,portrait,includeStrength=false,profile}={}){
 const card=pair=>{
  const name=champion(pair.id)?.name??String(pair.id),hasData=Number.isFinite(pair.raw)&&pair.games>0;
  const ignored=pair.multiplier===0,available=hasData&&Number.isFinite(pair.weighted);
  const value=ignored?'Ignored':available?signed(pair.weighted):'No data';
  const metadata=hasData?`<span title="Raw matchup delta: ${signed(pair.raw)} percentage points">${signed(pair.raw)} raw</span><span aria-hidden="true">·</span><span title="${pair.games.toLocaleString('en-US')} games" aria-label="${pair.games.toLocaleString('en-US')} games">${count(pair.games)} games</span>`:'<span>No data</span>';
  const weight=pair.multiplier!==1?`<p class="pair-weight">${ignored?'0× role weight':hasData?`${signed(pair.adjusted)} adjusted × ${pair.multiplier}`:`${pair.multiplier}× role weight`}</p>`:'';
  const limited=available&&!ignored&&pair.games<500?'<p class="pair-limited">Low sample</p>':'';
  return `<article class="pair-card ${pair.kind}"><div class="pair-title">${portrait(pair.id)}<span><small>${roleNames[pair.role]}</small><span class="pair-champion" title="${escape(name)}">${escape(name)}</span></span></div><strong class="pair-value ${!ignored&&available?tone(pair.weighted):'zero'}${!available||ignored?' pair-unavailable':''}">${value}</strong><p class="pair-metadata">${metadata}</p>${weight}${limited}</article>`;
 };
 const group=(side,kind,title,subtotal)=>{
  const pairs=row.pairs.filter(pair=>pair.side===side).sort((a,b)=>roleOrder.indexOf(a.role)-roleOrder.indexOf(b.role));
  const missing=pairs.some(pair=>pair.multiplier!==0&&!Number.isFinite(pair.weighted));
  return `<section class="contribution-group ${kind}" aria-label="${title}"><div class="contribution-heading"><h3>${title}</h3><span>${kind==='ally'?'Synergy':'Counters'} <b class="${missing?'zero':tone(subtotal)}">${missing?'No data':signed(subtotal)}</b></span></div><div class="pair-grid" style="--pair-count:${Math.max(1,pairs.length)}">${pairs.map(card).join('')||`<p class="pair-empty">${kind==='ally'?'No teammates revealed':'No enemies revealed'}</p>`}</div></section>`;
 };
 const base=includeStrength?`<div class="breakdown-base"><span>Base strength</span><strong class="${tone(row.base)}">${signed(row.base)}</strong><small>${(row.wr*100).toFixed(2)}% overall WR vs 50%</small></div>`:'';
 const intervals=row.pairs.filter(pair=>pair.multiplier>0).flatMap(pair=>{
  const range=contributionSamplingRange(pair,profile);
  if(!range)return [];
  const name=escape(champion(pair.id)?.name??pair.id);
  const label=pair.kind==='ally'?'With':'Against';
  return [`<li><span>${label} ${name} · ${roleNames[pair.role]}</span><span>${signed(range[0])} to ${signed(range[1])} pp</span></li>`];
 });
 const evidence=intervals.length?`<details class="pair-evidence"><summary>Contribution sampling ranges</summary><p>Approximate 95% ranges for individual contributions, treating expected win rates as fixed. Sample Δ shows how far Draft Edge moves when all matchup contributions reach their low or high bounds together. Base WR stays fixed.</p><ul>${intervals.join('')}</ul></details>`:'';
 const candidate=champion(row.id);
 return `<div class="breakdown-head"><div class="breakdown-identity">${portrait(row.id)}<h2>Why ${escape(candidate?.name??row.id)}?</h2></div><div class="breakdown-score"><span>Draft edge</span><strong class="breakdown-total ${row.complete===false?'zero':tone(row.score)}">${row.complete===false?'No data':signed(row.score)}</strong></div></div><p class="contribution-label">Adjusted contribution <span>pp</span></p><div class="contribution-groups">${group('allies','ally','With your team',row.synergy)}${group('enemies','enemy','Against the enemy',row.counter)}</div>${base}${evidence}`;
}
