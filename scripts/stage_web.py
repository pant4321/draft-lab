"""Prepare the public files for Vite development and production builds."""

from pathlib import Path
import shutil
from tempfile import TemporaryDirectory

from scripts.build_pages import build_pages


def main():
    root = Path(__file__).resolve().parents[1]
    build = root / 'build'
    build.mkdir(exist_ok=True)
    destination = build / 'web-public'
    if destination.resolve() != destination:
        raise ValueError('Refusing to replace a redirected web-public directory.')
    with TemporaryDirectory(dir=build) as scratch:
        staged = Path(scratch) / 'public'
        build_pages(root / 'dist', staged, static_source=root / 'web/public')
        shutil.copyfile(root / 'LICENSE', staged / 'license.txt')
        if destination.exists():
            destination.rename(Path(scratch) / 'previous')
        try:
            shutil.move(staged, destination)
        except OSError:
            previous = Path(scratch) / 'previous'
            if previous.exists() and not destination.exists():
                previous.rename(destination)
            raise


if __name__ == '__main__':
    main()
