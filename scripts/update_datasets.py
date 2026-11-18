"""Download missing patches or a fresh latest-patch capture, then rebuild offline."""
import argparse
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.patch_data import (EMERALD_DATASET, EMERALD_RANK, patch_key, preserve_history,
                                read_snapshot, rebuild, select_patch_snapshots, validate_scope)


def collect_patch(cache, patch, output, *, tier='all'):
    collector = ROOT / 'dist/data/collect_draft.py'
    subprocess.run([
        sys.executable, str(collector), '--cache', str(cache), '--patch', patch,
        '--output', str(output), '--all-listed-roles',
        *(['--tier', tier] if tier != 'all' else []),
    ], check=True)


def update(patches, data_root=ROOT/'dist/data', cache_root=ROOT/'cache-patches', *,
           refresh_latest=False, emerald_plus=False):
    data_root,cache_root=Path(data_root),Path(cache_root)
    preserve_history(data_root)
    for patch in sorted(set(patches),key=patch_key):
        output=data_root/'patches'/patch
        if (output/'snapshot.json').is_file():
            read_snapshot(output,patch)
            print(f'Patch {patch}: verified saved files; no download',flush=True)
            continue
        collect_patch(cache_root/patch,patch,output)
    if refresh_latest:
        saved=select_patch_snapshots(data_root)
        if not saved:
            raise ValueError('Collect a patch before refreshing the latest saved patch.')
        patch=saved[-1][1][0]['patch']
        capture=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        collect_patch(cache_root/'refreshes'/patch/capture,patch,
                      data_root/'patch-revisions'/patch/capture)
    if emerald_plus:
        saved = select_patch_snapshots(data_root)
        if not saved:
            raise ValueError('Collect an All ranks patch before backfilling Emerald+.')
        emerald_root = data_root / EMERALD_DATASET
        for _, (catalog, _, _) in saved:
            patch = catalog['patch']
            output = emerald_root / 'patches' / patch
            if (output / 'snapshot.json').is_file():
                validate_scope(read_snapshot(output, patch)[0], 'LoLalytics', rank=EMERALD_RANK)
                print(f'Emerald+ patch {patch}: verified saved files; no download', flush=True)
                continue
            collect_patch(cache_root / EMERALD_DATASET / patch, patch, output, tier='emerald_plus')
    result=rebuild(data_root)
    print('Combined saved patches: '+', '.join(result['datasets'][0]['patches']),flush=True)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--patches',nargs='*',default=[],help='Only missing patches are downloaded. All saved patches enter the combined view.')
    parser.add_argument('--data-root',type=Path,default=ROOT/'dist/data')
    parser.add_argument('--cache-root',type=Path,default=ROOT/'cache-patches')
    parser.add_argument('--refresh-latest',action='store_true',help='Save a fresh capture of the latest saved patch; preserve all earlier captures.')
    parser.add_argument('--emerald-plus', action='store_true', help='Backfill Emerald+ for every saved All ranks patch.')
    args=parser.parse_args()
    update(args.patches,args.data_root,args.cache_root,refresh_latest=args.refresh_latest,emerald_plus=args.emerald_plus)
