"""Immutable patch snapshots and an offline, game-weighted combined dataset."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
import shutil

ROLES = ('top', 'jungle', 'middle', 'bottom', 'support')
FILES = ('catalog.json', *(role + '.json' for role in ROLES))
CANDIDATE_FLOOR_ROLE_PERCENT = .5


def patch_key(patch):
    if not isinstance(patch, str) or not re.fullmatch(r'\d+\.\d+', patch):
        raise ValueError('Expected a discrete patch such as 16.22.')
    key = tuple(map(int, patch.split('.')))
    if min(key) < 1 or patch != f'{key[0]}.{key[1]}':
        raise ValueError('Patch must use canonical positive major.minor numbers.')
    return key


def encoded(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True, allow_nan=False).encode()


def patch_span(patches):
    groups=[]
    for value in sorted(patches,key=patch_key):
        key=patch_key(value)
        if groups and patch_key(groups[-1][-1])[0]==key[0] and patch_key(groups[-1][-1])[1]+1==key[1]:
            groups[-1].append(value)
        else:groups.append([value])
    return ', '.join(group[0] if len(group)==1 else group[0]+'–'+group[-1] for group in groups)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    path = Path(path);raw = encoded(value)
    if path.is_file() and path.read_bytes() == raw:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(raw);temporary.replace(path)


def write_snapshot(directory, catalog, profiles, *, kind, input_revision=None):
    directory = Path(directory);directory.mkdir(parents=True, exist_ok=True)
    write_json(directory / 'catalog.json', catalog)
    for role in ROLES:
        write_json(directory / (role + '.json'), {'profiles': profiles[role]})
    manifest = {'schemaVersion': 1, 'kind': kind, 'asOf': catalog['asOf'],
                'files': {name: digest((directory / name).read_bytes()) for name in FILES}}
    if kind == 'patch':
        manifest['patch'] = catalog['patch']
    if input_revision is not None:
        manifest['inputRevision'] = input_revision
    write_json(directory / 'snapshot.json', manifest)
    return manifest


def read_snapshot(directory, expected_patch=None):
    directory = Path(directory)
    manifest = json.loads((directory / 'snapshot.json').read_text(encoding='utf-8'))
    if set(manifest.get('files', {})) != set(FILES):
        raise ValueError(f'Incomplete snapshot manifest: {directory}')
    for name in FILES:
        if digest((directory / name).read_bytes()) != manifest['files'][name]:
            raise ValueError(f'Snapshot checksum mismatch: {directory / name}')
    catalog = json.loads((directory / 'catalog.json').read_text(encoding='utf-8'))
    profiles = {role: json.loads((directory / (role + '.json')).read_text(encoding='utf-8'))['profiles'] for role in ROLES}
    if catalog['profileCounts'] != {role: len(values) for role, values in profiles.items()} or manifest['asOf'] != catalog['asOf']:
        raise ValueError(f'Snapshot metadata mismatch: {directory}')
    if expected_patch is not None:
        patch_key(expected_patch)
        if manifest.get('kind') != 'patch' or manifest.get('patch') != expected_patch or catalog.get('patch') != expected_patch:
            raise ValueError(f'Wrong patch in snapshot: {directory}')
        for role, values in profiles.items():
            for profile in values.values():
                if profile.get('patch') != expected_patch or profile.get('role') != role:
                    raise ValueError(f'Mixed patch profile: {directory}')
    return catalog, profiles, manifest


def preserve_history(data_root):
    """Copy the original rolling window byte-for-byte, once, before replacement."""
    data_root = Path(data_root);history = data_root / 'history'
    existing = list(history.glob('30d-*/snapshot.json')) if history.is_dir() else []
    if existing:
        for path in existing:
            read_snapshot(path.parent)
        return sorted(path.parent for path in existing)
    source = data_root / 'draft'
    catalog = json.loads((source / 'catalog.json').read_text(encoding='utf-8'))
    if catalog.get('window') != '30 days':
        raise ValueError('Original 30-day snapshot must be archived before replacing it.')
    target = history / ('30d-' + catalog['asOf'][:10]);target.mkdir(parents=True, exist_ok=False)
    for name in FILES:
        shutil.copyfile(source / name, target / name)
    write_json(target / 'snapshot.json', {'schemaVersion': 1, 'kind': 'historical', 'asOf': catalog['asOf'],
               'files': {name: digest((target / name).read_bytes()) for name in FILES}})
    read_snapshot(target)
    return [target]


def validate_scope(catalog):
    expected = {'source': 'LoLalytics', 'rank': 'All ranks', 'region': 'Global', 'queue': 'Ranked solo/duo'}
    if any(catalog.get(key) != value for key, value in expected.items()) or catalog.get('errors'):
        raise ValueError('Only complete, matching all-ranks global solo/duo snapshots can be combined.')


def combine_values(snapshots):
    """Average patch-local published effects using each pair's own game count."""
    ordered = sorted(snapshots, key=lambda snapshot: patch_key(snapshot[0]['patch']))
    if not ordered:
        raise ValueError('No patches to combine.')
    patches = [catalog['patch'] for catalog, _, _ in ordered]
    if len(set(patches)) != len(patches):
        raise ValueError('A patch must appear exactly once; overlapping copies cannot be added.')
    champions, meta = {}, {}
    totals = {role: 0 for role in ROLES}
    for catalog, _, _ in ordered:
        validate_scope(catalog)
        for champion in catalog['champions']:
            cid = champion['id'];champions[cid] = {k: v for k, v in champion.items() if k != 'roles'}
            for role, value in champion['roles'].items():
                if role not in ROLES or value['games'] <= 0:
                    continue
                entry = meta.setdefault((cid, role), [0, 0.0])
                entry[0] += value['games'];entry[1] += value['games'] * value['wr'];totals[role] += value['games']
    for cid, champion in champions.items():
        champion['roles'] = {role: {'games': n, 'wr': wins / n, 'pickRate': 100 * n / totals[role]}
                              for (other, role), (n, wins) in meta.items() if other == cid}
    profile_parts = {role: {} for role in ROLES}
    for catalog, profiles, _ in ordered:
        for role in ROLES:
            for key, profile in profiles[role].items():
                profile_parts[role].setdefault(key, []).append((catalog['patch'], profile))
    output = {role: {} for role in ROLES}
    for role in ROLES:
        for key, parts in profile_parts[role].items():
            cid = int(key);c = champions[cid];candidate_meta = c['roles'].get(role)
            primary = max(c['roles'], key=lambda r: c['roles'][r]['games']) if c['roles'] else None
            n = sum(profile['games'] for _, profile in parts)
            if not candidate_meta or n < 1000 or candidate_meta['pickRate'] < CANDIDATE_FLOOR_ROLE_PERCENT and role != primary:
                continue
            result = {'id': cid, 'role': role, 'games': n, 'wr': sum(p['games'] * p['wr'] for _, p in parts) / n,
                      'enemy': {}, 'ally': {}, 'componentPatches': [patch for patch, _ in parts],
                      'sources': [dict(source, patch=patch) for patch, p in parts for source in p['sources']],
                      'fetchedAt': max(p['fetchedAt'] for _, p in parts)}
            for kind in ('enemy', 'ally'):
                for other_role in ROLES:
                    if kind == 'ally' and other_role == role:
                        continue
                    pairs = {}
                    for _, profile in parts:
                        for opponent, pair in profile[kind].get(other_role, {}).items():
                            delta, games, wr = pair
                            if not isinstance(games, int) or games <= 0 or not all(math.isfinite(v) for v in pair) or not 0 <= wr <= 1:
                                raise ValueError('Invalid archived pair.')
                            entry = pairs.setdefault(opponent, [0.0, 0, 0.0])
                            entry[0] += games * delta;entry[1] += games;entry[2] += games * wr
                    result[kind][other_role] = {opponent: [delta / games, games, wins / games]
                                               for opponent, (delta, games, wins) in pairs.items()}
            output[role][key] = result
    latest = ordered[-1][0]
    catalog = {'schemaVersion': 2, 'kind': 'combined', 'source': 'LoLalytics', 'rank': 'All ranks', 'region': 'Global',
               'queue': 'Ranked solo/duo', 'window': 'patches', 'patches': patches,
               'asOf': max(c['asOf'] for c, _, _ in ordered), 'ddragonVersion': latest['ddragonVersion'],
               'candidateFloorRolePercent': CANDIDATE_FLOOR_ROLE_PERCENT, 'aggregation': 'pair-game-weighted patch-local normalized deltas',
               'champions': sorted(champions.values(), key=lambda c: c['id']),
               'profileCounts': {role: len(values) for role, values in output.items()}, 'errors': [],
               'components': [{'patch': c['patch'], 'asOf': c['asOf'], 'snapshotSha256': digest(encoded(m))} for c, _, m in ordered]}
    return catalog, output


def rebuild(data_root):
    """Rebuild entirely offline; all completed patch files remain untouched."""
    data_root = Path(data_root)
    snapshots = [read_snapshot(path.parent, path.parent.name) for path in (data_root / 'patches').glob('*/snapshot.json')]
    if not snapshots:
        raise ValueError('No complete patch snapshots found.')
    revision = digest(encoded(sorted((c['patch'], digest(encoded(m))) for c, _, m in snapshots)))
    current = data_root / 'draft'
    try:
        catalog, _, manifest = read_snapshot(current)
        reusable = (manifest.get('kind') == 'combined' and manifest.get('inputRevision') == revision
                    and catalog.get('candidateFloorRolePercent') == CANDIDATE_FLOOR_ROLE_PERCENT)
    except (OSError, ValueError, KeyError):
        reusable = False
    if not reusable:
        catalog, profiles = combine_values(snapshots)
        manifest = write_snapshot(current, catalog, profiles, kind='combined', input_revision=revision)
    entries = [{'id': 'combined', 'label': 'Patches '+patch_span(catalog['patches']),
                'base': 'data/draft', 'kind': 'combined', 'asOf': catalog['asOf'],
                'revision': digest(encoded(manifest)), 'files': manifest['files'], 'patches': catalog['patches']}]
    for path in sorted((data_root / 'history').glob('*/snapshot.json')):
        old, _, old_manifest = read_snapshot(path.parent)
        entries.append({'id': path.parent.name, 'label': '30-day history', 'base': 'data/history/' + path.parent.name,
                        'kind': 'historical', 'asOf': old['asOf'], 'revision': digest(encoded(old_manifest)), 'files': old_manifest['files']})
    result = {'schemaVersion': 1, 'default': 'combined', 'datasets': entries}
    write_json(data_root / 'datasets.json', result)
    return result
