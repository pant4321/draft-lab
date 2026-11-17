"""Collect role-specific enemy and ally pairs from public LoLalytics pages/API.

The team endpoint is the same public endpoint used by the site's Synergy tab.
No Machine LoLing code, scores, or data are used. Cached parsed profiles make
interrupted collection resumable. Use a new cache directory for a new snapshot.
"""
import argparse, concurrent.futures, hashlib, json, math, time, urllib.request, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.patch_data import CANDIDATE_FLOOR_ROLE_PERCENT,read_snapshot,write_snapshot,write_json,patch_key
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
def collect(cache,patch='30',output=None,all_roles=False):
    cache=Path(cache);output=Path(output or ROOT/'dist/data/draft')
    if patch!='30':
        patch_key(patch)
        if (output/'snapshot.json').is_file():
            read_snapshot(output,patch);print(f'Patch {patch}: reusing complete snapshot (no download)',flush=True);return
        if output.exists():raise ValueError('Incomplete output directory exists; choose a clean output path.')
    elif (output/'catalog.json').is_file() and json.loads((output/'catalog.json').read_text()).get('kind')=='combined':
        raise ValueError('Use an explicit historical output directory for a new rolling-window capture.')
    cache.mkdir(parents=True,exist_ok=True)
    scope_file=cache/'scope.json'
    if scope_file.exists():
        scope=json.loads(scope_file.read_text())
        if scope['patch']!=patch or scope['allListedRoles']!=all_roles:raise ValueError('Cache belongs to a different collection scope.')
        version=scope['ddragonVersion']
    else:
        versions=json.loads(fetch('https://ddragon.leagueoflegends.com/api/versions.json'))
        version=next((v for v in versions if patch=='30' or v.startswith(patch+'.')),None)
        if version is None:raise ValueError('No Riot roster for requested patch.')
        write_json(scope_file,{'patch':patch,'allListedRoles':all_roles,'ddragonVersion':version})
    roster_url=f'https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json'
    roster=cache/'champions.json'
    if not roster.exists():roster.write_bytes(fetch(roster_url))
    champions=json.loads(roster.read_bytes())['data']
    catalog={int(c['key']):{'id':int(c['key']),'key':c['id'],'slug':c['id'].lower(),'name':c['name'],'roles':{}} for c in champions.values()}
    # Riot's asset key differs from the provider's public champion URL.
    catalog[62]['slug']='wukong'
    tier_sources={}
    def tier(role):
        url=f'https://lolalytics.com/lol/tierlist/?lane={role}&tier=all&patch={patch}'
        file=cache/f'tier-{role}.html'
        if not file.exists():file.write_bytes(fetch(url))
        raw=file.read_bytes();objs,ref=qwik(raw)
        context=next((o for o in objs if isinstance(o,dict) and all(k in o for k in ('patch','lane','tier','region'))),None)
        if context is None or any(str(ref(context[k]))!=value for k,value in {'patch':patch,'lane':role,'tier':'all','region':'all'}.items()):
            raise ValueError('Wrong patch or cohort in tier response.')
        tier_sources[role]={'url':url,'sha256':hashlib.sha256(raw).hexdigest()}
        return role,parse_tier(raw)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for role,rows in executor.map(tier,ROLES):
            for cid,meta in rows.items():
                if cid in catalog:catalog[cid]['roles'][role]=meta
    tasks=[]
    for cid,c in catalog.items():
        primary=max(c['roles'],key=lambda role:c['roles'][role]['games']) if c['roles'] else None
        for role,meta in c['roles'].items():
            if all_roles and meta['games']>0 or meta['games']>=1000 and (meta['pickRate']>=CANDIDATE_FLOOR_ROLE_PERCENT or role==primary):tasks.append((cid,role))
    print(f'Patch {patch}: planned {len(tasks)} champion-role profiles across {len(catalog)} champions',flush=True)
    def profile(task):
        cid,role=task;c=catalog[cid];path=cache/f'{cid}-{role}.json'
        if path.exists():
            saved=json.loads(path.read_text())
            if saved.get('patch')!=patch or saved.get('id')!=cid or saved.get('role')!=role:raise ValueError('Wrong patch in parsed profile cache.')
            return cid,role,saved
        base=f'https://lolalytics.com/lol/{c["slug"]}/build/?lane={role}&tier=all&patch={patch}'
        build=fetch(base);header,enemy=parse_build(build)
        if header['cid']!=cid or header['lane']!=role or str(header.get('patch'))!=patch or header.get('queue')!=420:raise ValueError('Wrong patch, champion, role or queue response')
        api=f'https://a1.lolalytics.com/mega/?ep=build-team&v=1&patch={patch}&c={c["slug"]}&lane={role}&tier=all&queue=ranked&region=all'
        team_raw=fetch(api);team=json.loads(team_raw)
        if 'team_h' not in team or 'team' not in team or team.get('response',{}).get('valid') is not True:raise ValueError('Missing or invalid team response')
        ally={r:compact(team['team_h'],v) for r,v in team['team'].items() if r!=role}
        result={'id':cid,'role':role,'patch':patch,'wr':header['wr']/100,'games':header['n'],'enemy':enemy,'ally':ally,
                'sources':[{'url':base,'sha256':hashlib.sha256(build).hexdigest()},{'url':api,'sha256':hashlib.sha256(team_raw).hexdigest()}],
                'fetchedAt':datetime.now(timezone.utc).isoformat()}
        write_json(path,result)
        return cid,role,result
    profiles={role:{} for role in ROLES};errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures={executor.submit(profile,task):task for task in tasks}
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            try:
                cid,role,value=future.result();profiles[role][str(cid)]=value
            except Exception as e:errors.append({'task':futures[future],'error':str(e)})
            if i%25==0 or i==len(tasks):print(f'Patch {patch}: profiles {i}/{len(tasks)}; failed {len(errors)}',flush=True)
    if errors:
        write_json(cache/'errors.json',errors)
        raise SystemExit(f'Patch {patch} collection incomplete; see {cache / "errors.json"}')
    assets=ROOT/'dist/assets';assets.mkdir(exist_ok=True)
    def asset(c):
        p=assets/(c['key']+'.png')
        if not p.exists():p.write_bytes(fetch(f'https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{c["key"]}.png'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:list(executor.map(asset,catalog.values()))
    metadata={'schemaVersion':2,'kind':'patch' if patch!='30' else 'historical','patch':patch,
              'source':'LoLalytics','rank':'All ranks','region':'Global','queue':'Ranked solo/duo','window':'30 days' if patch=='30' else patch,
              'asOf':datetime.now(timezone.utc).isoformat(),'ddragonVersion':version,'candidateFloorRolePercent':CANDIDATE_FLOOR_ROLE_PERCENT,
              'allListedRoles':all_roles,'rosterSource':{'url':roster_url,'sha256':hashlib.sha256(roster.read_bytes()).hexdigest()},
              'tierSources':tier_sources,'champions':list(catalog.values()),'profileCounts':{r:len(v) for r,v in profiles.items()},'errors':errors}
    output.parent.mkdir(parents=True,exist_ok=True)
    if patch!='30':
        staged=Path(tempfile.mkdtemp(prefix='snapshot-',dir=output.parent))
        write_snapshot(staged,metadata,profiles,kind='patch');read_snapshot(staged,patch);staged.replace(output)
    else:write_snapshot(output,metadata,profiles,kind='historical')
    print(json.dumps({'patch':patch,'profiles':metadata['profileCounts'],'output':str(output)}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=ROOT/'cache-draft');p.add_argument('--patch',default='30');p.add_argument('--output',type=Path);p.add_argument('--all-listed-roles',action='store_true');a=p.parse_args();collect(a.cache,a.patch,a.output,a.all_listed_roles)
