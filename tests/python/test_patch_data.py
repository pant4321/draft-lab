import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.patch_data import (ROLES, FILES, combine_values, patch_span, patch_key,
                                preserve_history, read_snapshot, rebuild, write_snapshot)
from scripts.update_datasets import update


def snapshot(patch_name='16.17', games=1000, pair_games=100, delta=-4, wr=.4):
    catalog={'source':'LoLalytics','rank':'All ranks','region':'Global','queue':'Ranked solo/duo',
             'patch':patch_name,'window':patch_name,'ddragonVersion':patch_name+'.1',
             'asOf':'2026-11-15T10:00:00+00:00','errors':[],
             'champions':[{'id':cid,'key':str(cid),'name':str(cid),'slug':str(cid),
                           'roles':{'jungle':{'games':games if cid==1 else 1000,'wr':.5,'pickRate':50}}} for cid in (1,2)],
             'profileCounts':{role:1 if role=='jungle' else 0 for role in ROLES}}
    profile={'id':1,'role':'jungle','patch':patch_name,'games':games,'wr':wr,
             'enemy':{'top':{'2':[delta,pair_games,wr]}},'ally':{'middle':{'2':[delta/2,pair_games,wr]}},
             'sources':[{'url':'https://example.test/'+patch_name,'sha256':'a'*64}],
             'fetchedAt':catalog['asOf']}
    profiles={role:{'1':profile} if role=='jungle' else {} for role in ROLES}
    return catalog,profiles,{'kind':'patch','patch':patch_name}


class PatchDataTests(unittest.TestCase):
    def test_role_eligibility_uses_half_percent_boundary_and_preserves_primary_roles(self):
        catalog,profiles,manifest=snapshot()
        cases=[(1,4999,False),(3,5000,False),(4,5001,False),(5,1200,True),(6,999,True)]
        cases.append((2,1000000-sum(n for _,n,_ in cases),True))
        template=profiles['jungle']['1'];catalog['champions']=[];profiles['jungle']={}
        for cid,n,primary in cases:
            roles={'jungle':{'games':n,'wr':.5,'pickRate':0}}
            if not primary:roles['middle']={'games':20000,'wr':.5,'pickRate':0}
            catalog['champions'].append({'id':cid,'key':str(cid),'name':str(cid),'slug':str(cid),'roles':roles})
            profiles['jungle'][str(cid)]={**copy.deepcopy(template),'id':cid,'games':n}
        combined,eligible=combine_values([(catalog,profiles,manifest)])
        self.assertEqual(combined['candidateFloorRolePercent'],.5)
        self.assertEqual(set(eligible['jungle']),{'2','3','4','5'})
        self.assertEqual(next(c for c in combined['champions'] if c['id']==3)['roles']['jungle']['pickRate'],.5)
        self.assertIn('jungle',next(c for c in combined['champions'] if c['id']==1)['roles'])

    def test_changed_eligibility_rebuilds_same_patch_inputs_then_reuses_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);c,p,_=snapshot();write_snapshot(root/'patches'/'16.17',c,p,kind='patch')
            before={str(path):path.read_bytes() for path in (root/'patches').rglob('*.json')}
            with patch('scripts.patch_data.CANDIDATE_FLOOR_ROLE_PERCENT',.25):
                old=rebuild(root)
            current=rebuild(root)
            self.assertNotEqual(old['datasets'][0]['revision'],current['datasets'][0]['revision'])
            self.assertEqual(read_snapshot(root/'draft')[0]['candidateFloorRolePercent'],.5)
            mtimes={str(path):path.stat().st_mtime_ns for path in root.rglob('*.json')}
            self.assertEqual(rebuild(root),current)
            self.assertEqual(mtimes,{str(path):path.stat().st_mtime_ns for path in root.rglob('*.json')})
            self.assertEqual(before,{str(path):path.read_bytes() for path in (root/'patches').rglob('*.json')})

    def test_pair_weights_use_each_pairs_games_and_keep_patch_normalization(self):
        first=snapshot('16.17',1000,100,-4,.4)
        second=snapshot('16.18',3000,900,2,.6)
        before=copy.deepcopy([first,second]);catalog,profiles=combine_values([second,first])
        value=profiles['jungle']['1']
        self.assertEqual(value['games'],4000);self.assertAlmostEqual(value['wr'],.55)
        self.assertAlmostEqual(value['enemy']['top']['2'][0],1.4)
        self.assertEqual(value['enemy']['top']['2'][1],1000)
        self.assertAlmostEqual(value['enemy']['top']['2'][2],.58)
        self.assertAlmostEqual(value['ally']['middle']['2'][0],.7)
        self.assertEqual(catalog['patches'],['16.17','16.18'])
        meta=catalog['champions'][0]['roles']['jungle']
        self.assertEqual(meta['games'],4000);self.assertAlmostEqual(meta['pickRate'],100*4000/6000)
        self.assertEqual([first,second],before)
        del second[1]['jungle']['1']['enemy']['top']['2']
        self.assertEqual(combine_values([first,second])[1]['jungle']['1']['enemy']['top']['2'],[-4.0,100,.4])

    def test_overlapping_patches_and_mixed_cohorts_are_rejected(self):
        self.assertEqual(patch_span(['16.17','16.18','16.20']),'16.17–16.18, 16.20')
        with self.assertRaises(ValueError):combine_values([snapshot(),snapshot()])
        wrong=snapshot('16.18');wrong[0]['rank']='Diamond+'
        with self.assertRaises(ValueError):combine_values([snapshot(),wrong])
        for value in ('30','../16.17','16.017','16.0'):
            with self.assertRaises(ValueError):patch_key(value)

    def test_original_30_day_files_are_preserved_byte_for_byte_and_never_mixed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);catalog,profiles,_=snapshot();catalog['window']='30 days'
            write_snapshot(root/'draft',catalog,profiles,kind='historical')
            original={name:(root/'draft'/name).read_bytes() for name in FILES}
            history=preserve_history(root)[0]
            for name in FILES:self.assertEqual((history/name).read_bytes(),original[name])
            c,p,_=snapshot();write_snapshot(root/'patches'/'16.17',c,p,kind='patch')
            manifest=rebuild(root)
            self.assertEqual([entry['kind'] for entry in manifest['datasets']],['combined','historical'])
            self.assertEqual(read_snapshot(root/'draft')[1]['jungle']['1']['games'],1000)
            self.assertEqual(preserve_history(root),[history])
            for name in FILES:self.assertEqual((history/name).read_bytes(),original[name])

    def test_completed_patches_skip_network_and_offline_rebuild_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);c,p,_=snapshot();c['window']='30 days'
            write_snapshot(root/'draft',c,p,kind='historical');preserve_history(root)
            for number in (17,18):
                c,p,_=snapshot('16.'+str(number));write_snapshot(root/'patches'/c['patch'],c,p,kind='patch')
            first=rebuild(root)
            before={str(path):path.stat().st_mtime_ns for path in root.rglob('*.json')}
            with patch('urllib.request.urlopen',side_effect=AssertionError('Network must not be used')):
                self.assertEqual(update(['16.18','16.17'],root,root/'cache'),first)
            self.assertEqual(before,{str(path):path.stat().st_mtime_ns for path in root.rglob('*.json')})
            (root/'draft'/'jungle.json').write_text('{}')
            self.assertEqual(rebuild(root),first)
            self.assertEqual(read_snapshot(root/'draft')[1]['jungle']['1']['games'],2000)
            c,p,_=snapshot('16.19');write_snapshot(root/'patches'/c['patch'],c,p,kind='patch')
            rebuild(root)
            self.assertEqual(read_snapshot(root/'draft')[0]['patches'],['16.17','16.18','16.19'])
            for path,mtime in before.items():
                if '/patches/' in path.replace('\\','/'):
                    self.assertEqual(Path(path).stat().st_mtime_ns,mtime)

    def test_snapshot_checksums_detect_corruption(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);c,p,_=snapshot();write_snapshot(root,c,p,kind='patch')
            read_snapshot(root,'16.17')
            (root/'jungle.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'checksum'):read_snapshot(root,'16.17')


if __name__=='__main__':unittest.main()
