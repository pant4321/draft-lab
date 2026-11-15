"""Collect role-specific enemy and ally pairs from public LoLalytics pages/API.

The team endpoint is the same public endpoint used by the site's Synergy tab.
No Machine LoLing code, scores, or data are used. Cached parsed profiles make
interrupted collection resumable. Use a new cache directory for a new snapshot.
"""
import argparse, concurrent.futures, hashlib, json, math, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
ROLES=['top','jungle','middle','bottom','support']
def fetch(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=45) as response:return response.read()
        except Exception as e:
            if attempt==2:raise
            time.sleep(1+attempt*2)
def qwik(raw):
    soup=BeautifulSoup(raw,'html.parser')
    element=soup.find('script',type='qwik/json')
    if element is None:raise ValueError('Missing Qwik data')
    objs=json.loads(element.string)['objs']
    return objs,lambda v:objs[int(v.rstrip('!'),36)]
def parse_tier(raw):
    objs,ref=qwik(raw);rows={}
    for o in objs:
        if isinstance(o,dict) and 'cid' in o and 'row' in o:
            row=ref(o['row']);rows[int(ref(o['cid']))]={k:ref(v) for k,v in row.items()}
    if len(rows)<20:raise ValueError('Too few tier rows')
    total=sum(r['games'] for r in rows.values())
    return {cid:{'wr':r['wr']/100,'games':r['games'],'pickRate':100*r['games']/total} for cid,r in rows.items()}
def compact(keys,rows):
    if not all(k in keys for k in ['id','d2','wr','n']):raise ValueError('Unknown pair schema')
    indexes={k:keys.index(k) for k in ['id','d2','wr','n']};out={}
    for row in rows:
        cid,delta,wr,n=[row[indexes[k]] for k in ['id','d2','wr','n']]
        if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in [cid,delta,wr,n]):continue
        if n>0:out[str(int(cid))]=[delta,int(n),wr/100]
    return out
def parse_build(raw):
    objs,ref=qwik(raw)
    root=next(o for o in objs if isinstance(o,dict) and all(k in o for k in ['header','enemy','enemy_h']))
    header={k:ref(v) for k,v in ref(root['header']).items()}
    keys=[ref(v) for v in ref(root['enemy_h'])]
    enemy={role:compact(keys,[[ref(v) for v in ref(row)] for row in ref(rows)]) for role,rows in ref(root['enemy']).items()}
    return header,enemy
def collect(cache):
    cache.mkdir(parents=True,exist_ok=True);(ROOT/'dist/data/draft').mkdir(exist_ok=True)
    version=json.loads(fetch('https://ddragon.leagueoflegends.com/api/versions.json'))[0]
    champions=json.loads(fetch(f'https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json'))['data']
    catalog={int(c['key']):{'id':int(c['key']),'key':c['id'],'slug':c['id'].lower(),'name':c['name'],'roles':{}} for c in champions.values()}
    # Riot's asset key differs from the provider's public champion URL.
    catalog[62]['slug']='wukong'
    def tier(role):
        url=f'https://lolalytics.com/lol/tierlist/?lane={role}&tier=all&patch=30'
        file=cache/f'tier-{role}.html'
        if not file.exists():file.write_bytes(fetch(url))
        return role,parse_tier(file.read_bytes())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for role,rows in executor.map(tier,ROLES):
            for cid,meta in rows.items():
                if cid in catalog:catalog[cid]['roles'][role]=meta
    tasks=[]
    for cid,c in catalog.items():
        primary=max(c['roles'],key=lambda role:c['roles'][role]['games']) if c['roles'] else None
        for role,meta in c['roles'].items():
            if meta['games']>=1000 and (meta['pickRate']>=.25 or role==primary):tasks.append((cid,role))
    print(f'Planned {len(tasks)} champion-role profiles across {len(catalog)} champions',flush=True)
    def profile(task):
        cid,role=task;c=catalog[cid];path=cache/f'{cid}-{role}.json'
        if path.exists():return cid,role,json.loads(path.read_text())
        base=f'https://lolalytics.com/lol/{c["slug"]}/build/?lane={role}&tier=all&patch=30'
        build=fetch(base);header,enemy=parse_build(build)
        if header['cid']!=cid or header['lane']!=role:raise ValueError('Wrong champion-role response')
        api=f'https://a1.lolalytics.com/mega/?ep=build-team&v=1&patch=30&c={c["slug"]}&lane={role}&tier=all&queue=ranked&region=all'
        team_raw=fetch(api);team=json.loads(team_raw)
        if 'team_h' not in team or 'team' not in team:raise ValueError('Missing team response')
        ally={r:compact(team['team_h'],v) for r,v in team['team'].items() if r!=role}
        result={'id':cid,'role':role,'wr':header['wr']/100,'games':header['n'],'enemy':enemy,'ally':ally,
                'sources':[{'url':base,'sha256':hashlib.sha256(build).hexdigest()},{'url':api,'sha256':hashlib.sha256(team_raw).hexdigest()}],
                'fetchedAt':datetime.now(timezone.utc).isoformat()}
        path.write_text(json.dumps(result,separators=(',',':')))
        return cid,role,result
    profiles={role:{} for role in ROLES};errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures={executor.submit(profile,task):task for task in tasks}
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            try:
                cid,role,value=future.result();profiles[role][str(cid)]=value
            except Exception as e:errors.append({'task':futures[future],'error':str(e)})
            if i%15==0 or i==len(tasks):print(f'Profiles {i}/{len(tasks)}; failed {len(errors)}',flush=True)
    assets=ROOT/'dist/assets';assets.mkdir(exist_ok=True)
    def asset(c):
        p=assets/(c['key']+'.png')
        if not p.exists():p.write_bytes(fetch(f'https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{c["key"]}.png'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:list(executor.map(asset,catalog.values()))
    metadata={'schemaVersion':1,'source':'LoLalytics','rank':'All ranks','region':'Global','queue':'Ranked solo/duo','window':'30 days',
              'asOf':datetime.now(timezone.utc).isoformat(),'ddragonVersion':version,'candidateFloorRolePercent':.25,
              'champions':list(catalog.values()),'profileCounts':{r:len(v) for r,v in profiles.items()},'errors':errors}
    for role,values in profiles.items():
        (ROOT/f'dist/data/draft/{role}.json').write_text(json.dumps({'profiles':values},separators=(',',':')))
    (ROOT/'dist/data/draft/catalog.json').write_text(json.dumps(metadata,separators=(',',':')))
    print(json.dumps({'profiles':metadata['profileCounts'],'errors':errors}),flush=True)
    if errors:raise SystemExit('Collection incomplete; inspect missing profiles before publishing')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=ROOT/'cache-draft');a=p.parse_args();collect(a.cache)
