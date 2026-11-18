"""Stage the website and its public combined datasets."""
import argparse
import json
from pathlib import Path
import shutil

from scripts.patch_data import ALL_RANKS, EMERALD_DATASET, EMERALD_RANK, FILES, read_snapshot, write_json

PUBLIC_DATASETS = {
    'combined': ('draft', ALL_RANKS),
    EMERALD_DATASET: (f'{EMERALD_DATASET}/draft', EMERALD_RANK),
}


def build_pages(source, destination):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    if destination.is_relative_to(source):
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
        datasets.append((entry, directory))

    def exclude_data(directory, _names):
        return {'data'} if Path(directory) == source else set()

    shutil.copytree(source, destination, ignore=exclude_data)
    published_data = destination / 'data'
    for _, directory in datasets:
        (published_data / directory).mkdir(parents=True)
        for name in FILES:
            shutil.copyfile(source_data / directory / name, published_data / directory / name)
    write_json(published_data / 'datasets.json', {
        'schemaVersion': index['schemaVersion'], 'default': index['default'],
        'datasets': [entry for entry, _ in datasets],
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    build_pages(Path(__file__).resolve().parents[1] / 'dist', args.destination)
