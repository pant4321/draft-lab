"""Download only missing patches, then rebuild the combined view offline."""
import argparse
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.patch_data import preserve_history,rebuild,patch_key,read_snapshot


def update(patches, data_root=ROOT/'dist/data', cache_root=ROOT/'cache-patches'):
    data_root,cache_root=Path(data_root),Path(cache_root)
    preserve_history(data_root)
    for patch in sorted(set(patches),key=patch_key):
        output=data_root/'patches'/patch
        if (output/'snapshot.json').is_file():
            read_snapshot(output,patch)
            print(f'Patch {patch}: verified saved files; no download',flush=True)
            continue
        from scripts.collect_draft import collect
        collect(cache_root/patch,patch,output,all_roles=True)
    result=rebuild(data_root)
    print('Combined saved patches: '+', '.join(result['datasets'][0]['patches']),flush=True)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--patches',nargs='*',default=[],help='Only missing patches are downloaded. All saved patches enter the combined view.')
    parser.add_argument('--data-root',type=Path,default=ROOT/'dist/data')
    parser.add_argument('--cache-root',type=Path,default=ROOT/'cache-patches')
    args=parser.parse_args();update(args.patches,args.data_root,args.cache_root)
