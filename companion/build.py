"""Build DraftLab.exe with a bundled Python runtime, UI, stats, and Riot CA."""
from pathlib import Path
import struct
import subprocess
import sys
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def make_icon(path):
    size = 64
    pixels = bytearray()
    for y in range(size - 1, -1, -1):
        for x in range(size):
            distance = abs(x - 31.5) + abs(y - 31.5)
            color = (178, 231, 195) if 19 <= distance <= 25 else (16, 23, 25)
            pixels += bytes((color[2], color[1], color[0], 255))
    bitmap = struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
    image = bitmap + pixels + bytes(size * size // 8)
    path.write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(image), 22) + image)


def main():
    subprocess.run(['node', '--test', *map(str, sorted((ROOT / 'tests').glob('*.test.mjs')))], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'companion/tests'], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/python'], cwd=ROOT, check=True)
    icon = ROOT / 'companion/assets/draftlab.ico'
    make_icon(icon)
    (ROOT/'build').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='companion-web-',dir=ROOT/'build') as directory:
        stage=Path(directory).resolve()
        if not stage.is_relative_to((ROOT/'build').resolve()):
            raise ValueError('Web staging directory must remain inside build/.')
        # The app uses the combined/history views. Source patch archives remain in the repo.
        shutil.copytree(ROOT/'dist',stage/'web',ignore=lambda folder,names:['patches'] if Path(folder)==ROOT/'dist/data' else [])
        subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onefile', '--windowed', '--noupx',
                        '--name', 'DraftLab', '--distpath', str(ROOT / 'build/companion-release'),
                        '--workpath', str(ROOT / 'build/pyinstaller'), '--specpath', str(ROOT / 'build'),
                        '--paths', str(ROOT), '--icon', str(icon),
                        '--add-data', str(stage/'web') + ':web',
                        '--add-data', str(ROOT / 'companion/assets') + ':companion/assets',
                        str(ROOT / 'companion/app.py')], cwd=ROOT, check=True)
    print(ROOT / 'build/companion-release/DraftLab.exe')


if __name__ == '__main__':
    main()
