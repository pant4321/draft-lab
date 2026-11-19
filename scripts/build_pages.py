"""Stage assets, combined datasets, and public patch stats for the web build."""
import json
from pathlib import Path
import shutil

from scripts.patch_data import (ALL_RANKS, EMERALD_DATASET, EMERALD_RANK, FILES, digest,
                                read_snapshot, validate_scope, write_json)

PUBLIC_DATASETS = {
    'combined': ('draft', ALL_RANKS),
    EMERALD_DATASET: (f'{EMERALD_DATASET}/draft', EMERALD_RANK),
}


def publish_patch_input(source, published_data, dataset, component, rank, stats_source):
    patch = component['patch']
    base = component['base']
    if not base.startswith('data/'):
        raise ValueError(f'Invalid snapshot path for patch {patch}.')
    directory = (source / base).resolve()
    if not directory.is_relative_to(source / 'data'):
        raise ValueError(f'Patch {patch} snapshot is outside the data directory.')
    if digest((directory / 'snapshot.json').read_bytes()) != component['snapshotSha256']:
        raise ValueError(f'Patch {patch} no longer matches the combined dataset.')
    catalog, profiles, _ = read_snapshot(directory, patch)
    validate_scope(catalog, stats_source, rank=rank)

    # The client needs aggregate statistics, rather than archived capture files.
    target = published_data / 'patch-inputs' / dataset / patch
    champions = [{**{field: champion[field] for field in ('id', 'name', 'key')},
                  'roles': {role: {field: stats[field] for field in ('games', 'wr')}
                            for role, stats in champion['roles'].items()}}
                 for champion in catalog['champions']]
    write_json(target / 'catalog.json', {
        'patch': patch, 'rank': rank, 'asOf': catalog['asOf'], 'champions': champions,
    })
    for role, values in profiles.items():
        write_json(target / f'{role}.json', {'profiles': {
            champion: {field: profile[field] for field in ('games', 'wr', 'enemy', 'ally')}
            for champion, profile in values.items()
        }})
    return {'patch': patch, 'base': 'data/' + target.relative_to(published_data).as_posix(),
            'files': {name: digest((target / name).read_bytes()) for name in FILES}}


def build_pages(source, destination, *, static_source=None):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    static_source = Path(static_source).resolve() if static_source is not None else source
    if destination.is_relative_to(source) or destination.is_relative_to(static_source):
        raise ValueError('Pages output must be outside the website source directory.')

    source_data = source / 'data'
    index = json.loads((source_data / 'datasets.json').read_text(encoding='utf-8'))
    combined = next((entry for entry in index['datasets'] if entry['id'] == 'combined'), None)
    if index['schemaVersion'] != 1 or index['default'] != 'combined' or not combined:
        raise ValueError('Pages requires a combined default dataset in data/draft.')
    datasets = []
    for entry in index['datasets']:
        if entry['id'] not in PUBLIC_DATASETS:
            continue
        directory, rank = PUBLIC_DATASETS[entry['id']]
        if entry['kind'] != 'combined' or entry['base'] != f'data/{directory}':
            raise ValueError(f'Unexpected public dataset path or kind for {rank}.')
        catalog, _, manifest = read_snapshot(source_data / directory)
        if (manifest.get('kind') != 'combined' or entry['files'] != manifest['files'] or
                entry.get('rank', rank) != rank or catalog['rank'] != rank or
                entry['patches'] != catalog['patches'] or entry['patches'] != combined['patches']):
            raise ValueError(f'The {rank} dataset index does not match its combined snapshot or patch coverage.')
        if [component['patch'] for component in catalog['components']] != entry['patches']:
            raise ValueError(f'The {rank} dataset does not identify all its patch snapshots.')
        datasets.append((entry, directory, catalog))

    def exclude_data(directory, _names):
        return {'data'} if Path(directory) == static_source else set()

    shutil.copytree(static_source, destination, ignore=exclude_data)
    published_data = destination / 'data'
    public_entries = []
    for entry, directory, catalog in datasets:
        (published_data / directory).mkdir(parents=True)
        for name in FILES:
            shutil.copyfile(source_data / directory / name, published_data / directory / name)
        inputs = [publish_patch_input(source, published_data, entry['id'], component, catalog['rank'], catalog['source'])
                  for component in catalog['components']]
        public_entries.append({**entry, 'patchInputs': inputs})
    write_json(published_data / 'datasets.json', {
        'schemaVersion': index['schemaVersion'], 'default': index['default'],
        'datasets': public_entries,
    })
