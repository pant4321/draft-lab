export function expected(a,b,synergy=false,neutral=.5) {
  if (![a,b,neutral].every(x=>Number.isFinite(x)&&x>0&&x<1)) throw Error('Win rates must be between 0 and 1.');
  const baseline=neutral/(1-neutral);
  const odds=synergy?(a/(1-a))*(b/(1-b))/baseline:(a/(1-a))/(b/(1-b))*baseline;
  return odds/(1+odds);
}
export function validate(data) {
  if (!data || !Array.isArray(data.rows) || data.rows.length<2) throw Error('Need at least two matchups.');
  expected(data.qiyanaWr,.5);
  expected(data.neutralWr??.5,.5);
  const ids=new Set();
  for (const r of data.rows) {
    if (!r.champion || ids.has(r.champion)) throw Error('Missing or duplicate champion.');
    ids.add(r.champion);
    if (!Number.isInteger(r.games)||r.games<2||!Number.isFinite(r.observedWr)||r.observedWr<0||r.observedWr>1||!Number.isFinite(r.pickRate)||r.pickRate<0) throw Error('Invalid matchup counts, rate or weight.');
    expected(.5,r.opponentWr);
  }
  return data;
}
export function wilson(p,n) {
  const z=1.95996398454,den=1+z*z/n;
  const center=(p+z*z/(2*n))/den;
  const half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  return [center-half,center+half];
}
export function cdf(z) {
  const x=Math.abs(z)/Math.sqrt(2),t=1/(1+.3275911*x);
  const erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);
  return .5*(1+Math.sign(z)*erf);
}
export function analyze(data,{floor=.5,minGames=100,weighted=true,threshold=-2}={}) {
  validate(data);
  const rows=data.rows.filter(r=>r.pickRate>=floor&&r.games>=minGames).map(r=>{
    const exp=expected(data.qiyanaWr,r.opponentWr,false,data.neutralWr??.5),delta=100*(r.observedWr-exp);
    return {...r,expectedWr:exp,delta,ci:wilson(r.observedWr,r.games).map(x=>100*(x-exp)),
      noise:10000*r.observedWr*(1-r.observedWr)/(r.games-1)};
  });
  const total=rows.reduce((s,r)=>s+(weighted?r.pickRate:1),0);
  if(rows.length<2||total<=0) return null;
  rows.forEach(r=>r.weight=(weighted?r.pickRate:1)/total);
  const mean=rows.reduce((s,r)=>s+r.weight*r.delta,0);
  const observedVariance=rows.reduce((s,r)=>s+r.weight*(r.delta-mean)**2,0);
  // Centering by the measured weighted mean removes sum(w_i^2 v_i) of noise.
  // p_hat(1-p_hat)/(n-1) estimates Var(p_hat) without plug-in bias.
  const noiseVariance=rows.reduce((s,r)=>s+r.weight*(1-r.weight)*r.noise,0);
  const rawTrueVariance=observedVariance-noiseVariance;
  const sigma=Math.sqrt(Math.max(0,rawTrueVariance));
  return {rows,mean,observed:Math.sqrt(observedVariance),noise:Math.sqrt(noiseVariance),sigma,rawTrueVariance,
    tail:sigma>0?cdf((threshold-mean)/sigma):null,
    counted:rows.filter(r=>r.delta<threshold).reduce((s,r)=>s+r.weight,0),
    games:rows.reduce((s,r)=>s+r.games,0)};
}
