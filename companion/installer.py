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
from companion.updates import EXECUTABLE_NAME, INSTALLER_NAME, PORTABLE_NAME, version_tuple

ROOT = Path(__file__).resolve().parent
RELEASE = ROOT.parent / 'build' / 'companion-release'
BUNDLE = RELEASE / 'DraftLab'


def build_installer(compiler, payload, output, version):
    version_tuple(version)
    compiler, payload, output = (Path(path).resolve() for path in (compiler, payload, output))
    if not compiler.is_file() or not (payload.is_file() or (payload / EXECUTABLE_NAME).is_file()):
        raise FileNotFoundError('Supply ISCC.exe and build the companion before packaging.')
    directive = 'BundlePath' if payload.is_dir() else 'ExecutablePath'
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(compiler), '/Qp', f'/O{output}', f'/DAppVersion={version}',
                    f'/D{directive}={payload}', str(ROOT / 'installer' / 'setup.iss')],
                   check=True)
    return output / INSTALLER_NAME


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iscc', type=Path, default=shutil.which('ISCC.exe'))
    args = parser.parse_args()
    if args.iscc is None:
        parser.error('Pass --iscc with the path to the Inno Setup compiler.')
    installer = build_installer(args.iscc, BUNDLE, RELEASE, VERSION)
    portable = Path(shutil.make_archive(str((RELEASE / PORTABLE_NAME).with_suffix('')), 'zip',
                                       root_dir=RELEASE, base_dir=BUNDLE.name))
    for path in (portable, installer):
        digest = sha256(path.read_bytes()).hexdigest()
        path.with_suffix(path.suffix + '.sha256').write_text(f'{digest}  {path.name}\n', encoding='ascii')
    print(installer)


if __name__ == '__main__':
    main()
