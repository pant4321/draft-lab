"""Collect a small, auditable Qiyana snapshot. Run with Python + beautifulsoup4.
Source HTML stays outside the published site. No Machine LoLing data is reused.
"""
import argparse, hashlib, json, re, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
def get(url):
    return urllib.request.urlopen(url, timeout=40).read()
def normalize(s):
    return re.sub('[^a-z0-9]', '', s.lower())
def collect(cache, tier='all', output=None):
    cache.mkdir(parents=True, exist_ok=True)
    urls = {
      'counters': f'https://lolalytics.com/lol/qiyana/counters/?lane=middle&tier={tier}&patch=30',
      'build': f'https://lolalytics.com/lol/qiyana/build/?lane=middle&tier={tier}&patch=30',
      'tier': f'https://lolalytics.com/lol/tierlist/?lane=middle&tier={tier}&patch=30'}
    raw = {}
    for key,url in urls.items():
        p=cache/(key+'.html')
        if not p.exists(): p.write_bytes(get(url))
        raw[key]=p.read_bytes()
    version=json.loads(get('https://ddragon.leagueoflegends.com/api/versions.json'))[0]
    champs=json.loads(get(f'https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json'))['data']
    names={normalize(c[k]):c for c in champs.values() for k in ['id','name']}
    soup=BeautifulSoup(raw['tier'],'html.parser')
    objs=json.loads(soup.find('script',{'type':'qwik/json'}).string)['objs']
    def ref(v): return objs[int(v.rstrip('!'),36)]
    tiers={}
    for o in objs:
        if isinstance(o,dict) and 'cid' in o and 'row' in o:
            r=ref(o['row'])
            tiers[int(ref(o['cid']))]={k:ref(v) for k,v in r.items()}
    build=BeautifulSoup(raw['build'],'html.parser').get_text(' ',strip=True)
    qwr=float(re.search(r'Qiyana middle has a ([\d.]+)% win rate',build)[1])
    qgames=int(re.search(r'Ban Rate ([\d,]+) Games',build)[1].replace(',',''))
    rows=[]
    for a in BeautifulSoup(raw['counters'],'html.parser').find_all('a'):
        text=a.get_text(' ',strip=True)
        m=re.fullmatch(r'(.+?) ([\d.]+) % VS Δ 1 ([-\d.]+) • Δ 2 ([-\d.]+) ([\d.]+) % VS ([\d,]+) Games',text)
        if not m: continue
        name,wr,d1,d2,against,n=m.groups()
        champ=names.get(normalize(name))
        if champ is None: raise ValueError('Unknown champion '+name)
        cid=int(champ['key']); meta=tiers.get(cid)
        if meta is None: continue
        # The table's "All Champs WR" is the average opponent's WR AGAINST this champion.
        opponent_wr=100-float(against)
        if abs(opponent_wr-float(meta['wr'])) > .03:
            raise ValueError('Baseline mismatch '+name)
        rows.append(dict(champion=name,id=champ['id'],championId=cid,games=int(n.replace(',','')),
          observedWr=float(wr)/100,opponentWr=opponent_wr/100,
          pickRate=100*meta['games']/sum(v['games'] for v in tiers.values()),
          sourcePickRate=float(meta['pr']),metaGames=meta['games'],
          publishedDelta2=float(d2),icon=f'assets/{champ["id"]}.png'))
    if len(rows)<50: raise ValueError('Too few rows; source markup may have changed')
    if len({r['championId'] for r in rows}) != len(rows): raise ValueError('Duplicate rows')
    assets=ROOT/'dist/assets';assets.mkdir(exist_ok=True)
    for r in rows+[{ 'id':'Qiyana' }]:
        target=assets/(r['id']+'.png')
        if not target.exists():target.write_bytes(get(f'https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{r["id"]}.png'))
    neutral=float(re.search(r'Average .+? Win Rate: ([\d.]+) %',build)[1])/100
    data=dict(schemaVersion=2,champion='Qiyana',role='middle',rank={'all':'All ranks','diamond_plus':'Diamond+'}[tier],region='Global',queue='Ranked solo/duo',
      window='30 days',collectedAt=datetime.fromtimestamp(max((cache/(k+'.html')).stat().st_mtime for k in urls),timezone.utc).isoformat(),
      neutralWr=neutral,pickRateUnit='percent_of_listed_role_games',metaRoleGames=sum(v['games'] for v in tiers.values()),
      qiyanaWr=qwr/100,qiyanaGames=qgames,ddragonVersion=version,
      sources=[dict(url=u,sha256=hashlib.sha256(raw[k]).hexdigest()) for k,u in urls.items()],
      limitations=['Different cohort from the video. Exact ten patch dataset and filters unavailable.',
       'Source rates are rounded to two decimal places; wins are not reported as exact counts.',
       'Noise correction treats estimated baseline win rates as fixed and matchups as independent.',
       'Pick rates are shares of games in the full published role tier list, before filtering. Rare picks omitted by that list are not in its denominator.',
       'Normal curve is a model assumption, not a normality test or a per-match prediction.'],rows=rows)
    (output or ROOT/'dist/data/qiyana.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
    print(f'Collected {len(rows)} matchups; Qiyana WR {qwr}%; {qgames:,} games')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=ROOT/'cache');p.add_argument('--tier',choices=['all','diamond_plus'],default='all');p.add_argument('--output',type=Path);a=p.parse_args();collect(a.cache,a.tier,a.output)
