"""Stage the website and the combined files required by the browser."""
import argparse
import json
from pathlib import Path
import shutil

from scripts.patch_data import FILES, read_snapshot, write_json


def build_pages(source, destination):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    if destination.is_relative_to(source):
        raise ValueError('Pages output must be outside the website source directory.')

    source_data = source / 'data'
    index = json.loads((source_data / 'datasets.json').read_text(encoding='utf-8'))
    combined = next((entry for entry in index['datasets'] if entry['id'] == index['default']), None)
    if (index['schemaVersion'] != 1 or not combined or
            combined['kind'] != 'combined' or combined['base'] != 'data/draft'):
        raise ValueError('Pages requires a combined default dataset in data/draft.')
    _, _, manifest = read_snapshot(source_data / 'draft')
    if combined['files'] != manifest['files']:
        raise ValueError('The combined dataset index does not match its snapshot.')

    def exclude_data(directory, _names):
        return {'data'} if Path(directory) == source else set()

    shutil.copytree(source, destination, ignore=exclude_data)
    published_data = destination / 'data'
    (published_data / 'draft').mkdir(parents=True)
    for name in FILES:
        shutil.copyfile(source_data / 'draft' / name, published_data / 'draft' / name)
    write_json(published_data / 'datasets.json', {
        'schemaVersion': index['schemaVersion'], 'default': index['default'], 'datasets': [combined],
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    build_pages(Path(__file__).resolve().parents[1] / 'dist', args.destination)
