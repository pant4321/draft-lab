"""Freeze the Windows companion and its replaceable Qt libraries."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

def main():
    npm = shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
    if not npm:
        raise RuntimeError('Install Node.js and run npm ci before building the companion.')
    subprocess.run([npm, 'test'], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'companion/tests'], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/python'], cwd=ROOT, check=True)
    icon = ROOT / 'web/public/favicon.ico'
    output = ROOT / 'build/companion-release'
    environment = os.environ.copy()
    if sys.platform == 'win32':
        # PyInstaller searches PATH for DLLs. Keep third-party copies of Windows ICU out of Qt.
        windows = Path(os.environ['SystemRoot'])
        environment['PATH'] = os.pathsep.join((str(windows / 'System32'), str(windows)))
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onedir', '--windowed', '--noupx',
                    '--name', 'DraftLab', '--distpath', str(output), '--workpath', str(ROOT / 'build/pyinstaller'),
                    '--specpath', str(ROOT / 'build'), '--paths', str(ROOT), '--icon', str(icon),
                    '--add-data', str(ROOT / 'companion/assets') + ':companion/assets',
                    '--add-data', str(icon) + ':web/public',
                    str(ROOT / 'companion/app.py')], cwd=ROOT, env=environment, check=True)
    bundle = output / 'DraftLab'
    for notice in (ROOT / 'LICENSE', ROOT / 'companion/THIRD-PARTY-NOTICES.md', ROOT / 'companion/licenses'):
        if notice.is_dir():
            shutil.copytree(notice, bundle / notice.name)
        else:
            shutil.copy2(notice, bundle / notice.name)
    print(bundle / 'DraftLab.exe')


if __name__ == '__main__':
    main()
