# DraftEdge Companion third-party notices

DraftEdge Companion uses Qt, PySide6 Essentials, and Shiboken6 6.12.0 from the Qt Project. These libraries are distributed under the GNU Lesser General Public License version 3. Copies of the LGPL and the GNU General Public License version 3 are included in the `licenses` directory.

The original library sources for this build are available from the Qt Project.

- [Qt Base 6.12.0](https://github.com/qt/qtbase/tree/v6.12.0)
- [Qt SVG 6.12.0](https://github.com/qt/qtsvg/tree/v6.12.0)
- [PySide6 and Shiboken6 6.12.0](https://download.qt.io/official_releases/QtForPython/pyside6/PySide6-6.12.0-src/)

Qt's source trees contain [third-party license notices](https://doc.qt.io/qt-6/licenses-used-in-qt.html) for their bundled code. DraftEdge uses the published Qt for Python wheels without modifying the libraries.

The Qt DLLs, Python extensions, and plugins are loaded from `_internal` next to `DraftLab.exe`. To use a compatible modified library, quit the companion, replace the relevant files in that directory, and reopen the executable. The portable ZIP can be extracted to any writable directory.

The accompanying `LICENSE` covers DraftEdge. The corresponding DraftEdge source and build instructions are available from the [repository and its release tags](https://github.com/pant4321/draft-lab/releases).
