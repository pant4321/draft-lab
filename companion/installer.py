"""Package the frozen companion using Inno Setup."""
import argparse
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from companion.app import VERSION
from companion.updates import INSTALLER_NAME, PORTABLE_NAME, version_tuple

ROOT = Path(__file__).resolve().parent
RELEASE = ROOT.parent / 'build' / 'companion-release'


def build_installer(compiler, executable, output, version):
    version_tuple(version)
    compiler, executable, output = (Path(path).resolve() for path in (compiler, executable, output))
    if not compiler.is_file() or not executable.is_file():
        raise FileNotFoundError('Supply ISCC.exe and build the companion before packaging.')
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(compiler), '/Qp', f'/O{output}', f'/DAppVersion={version}',
                    f'/DExecutablePath={executable}', str(ROOT / 'installer' / 'setup.iss')],
                   check=True)
    return output / INSTALLER_NAME


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iscc', type=Path, default=shutil.which('ISCC.exe'))
    args = parser.parse_args()
    if args.iscc is None:
        parser.error('Pass --iscc with the path to the Inno Setup compiler.')
    portable = RELEASE / PORTABLE_NAME
    installer = build_installer(args.iscc, portable, RELEASE, VERSION)
    for path in (portable, installer):
        digest = sha256(path.read_bytes()).hexdigest()
        path.with_suffix(path.suffix + '.sha256').write_text(f'{digest}  {path.name}\n', encoding='ascii')
    print(installer)


if __name__ == '__main__':
    main()
