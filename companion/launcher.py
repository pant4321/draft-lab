"""Quick Controls and the native Windows system tray."""
import os
from pathlib import Path
import sys
import webbrowser

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (QApplication, QCheckBox, QFileDialog, QFrame, QHBoxLayout, QLabel,
                               QLayout, QMenu, QMessageBox, QPushButton, QSystemTrayIcon,
                               QVBoxLayout, QWidget)

from companion.preferences import read_settings, update_settings
from companion.startup import set_start_with_windows, startup_command, starts_with_windows

ASSETS = Path(__file__).resolve().parent / "assets"
APP_ICON = ASSETS.parent.parent / "web/public/favicon.ico"


def label(text="", name=""):
    widget = QLabel(text)
    widget.setTextFormat(Qt.TextFormat.PlainText)
    if name:
        widget.setObjectName(name)
    return widget


def glyph(name, size):
    widget = QLabel()
    widget.setPixmap(QIcon(str(ASSETS / "ui" / (name + ".svg"))).pixmap(QSize(size, size), widget.devicePixelRatioF()))
    return widget


class SettingRow(QWidget):
    def __init__(self, name, description, icon, *, checked, enabled=True):
        super().__init__()
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 11, 12, 11)
        layout.setSpacing(12)
        layout.addWidget(glyph(icon, 18))
        copy = QVBoxLayout()
        copy.setSpacing(3)
        copy.addWidget(label(name, "settingTitle"))
        copy.addWidget(label(description, "detail"))
        layout.addLayout(copy, 1)
        self.switch = QCheckBox()
        self.switch.setAccessibleName(name)
        self.switch.setAccessibleDescription(description)
        self.switch.setChecked(checked)
        self.switch.setEnabled(enabled)
        layout.addWidget(self.switch)
        if enabled:
            self.setCursor(Qt.CursorShape.PointingHandCursor)
        else:
            self.setEnabled(False)

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and self.switch.isEnabled():
            self.switch.click()
            event.accept()
        else:
            super().mouseReleaseEvent(event)


class LauncherWindow(QWidget):
    def __init__(self, server, poller, stop, updates, title, activation, icon):
        super().__init__()
        self.server, self.poller, self.stop, self.updates = server, poller, stop, updates
        self.activation = activation
        self.last_connection = self.last_update = None
        self.update_action = None
        self.setObjectName("launcher")
        self.setWindowTitle(title)
        self.setWindowIcon(icon)
        outer = QVBoxLayout(self)
        outer.setSizeConstraint(QLayout.SizeConstraint.SetFixedSize)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        body = QVBoxLayout()
        body.setContentsMargins(20, 20, 20, 20)
        body.setSpacing(0)
        outer.addLayout(body)
        self.connection = QFrame()
        self.connection.setObjectName("connectionCard")
        connection = QHBoxLayout(self.connection)
        connection.setContentsMargins(16, 15, 16, 15)
        connection.setSpacing(12)
        status_icon = QFrame()
        status_icon.setObjectName("statusIcon")
        status_icon.setFixedSize(36, 36)
        icon_layout = QHBoxLayout(status_icon)
        icon_layout.setContentsMargins(0, 0, 0, 0)
        icon_layout.addWidget(glyph("link", 18), alignment=Qt.AlignmentFlag.AlignCenter)
        connection.addWidget(status_icon)
        status_copy = QVBoxLayout()
        status_copy.setSpacing(3)
        self.connection_title = label(name="connectionTitle")
        self.connection_detail = label(name="detail")
        self.connection_detail.setWordWrap(True)
        self.connection_detail.setFixedWidth(260)
        status_copy.addWidget(self.connection_title)
        status_copy.addWidget(self.connection_detail)
        connection.addLayout(status_copy, 1)
        open_button = QPushButton("Open DraftEdge  ↗")
        open_button.setObjectName("openDraftEdge")
        open_button.clicked.connect(lambda: webbrowser.open_new_tab(server.launch_url))
        connection.addWidget(open_button)
        body.addWidget(self.connection)

        body.addSpacing(20)
        body.addWidget(label("Windows behavior", "settingTitle"))
        body.addSpacing(8)
        settings = QFrame()
        settings.setObjectName("settingsCard")
        rows = QVBoxLayout(settings)
        rows.setContentsMargins(1, 0, 1, 0)
        rows.setSpacing(0)
        self.startup_command = startup_command()
        startup_help = "Launch when you sign in."
        startup_enabled = False
        if self.startup_command is None:
            startup_help = "Available in the Windows executable."
        else:
            try:
                startup_enabled = starts_with_windows(self.startup_command)
            except OSError:
                startup_help = "Windows startup settings could not be read."
                self.startup_command = None

        startup = SettingRow("Start with Windows", startup_help, "power",
                             checked=startup_enabled, enabled=self.startup_command is not None)
        startup.switch.clicked.connect(self.save_startup)
        self.startup = startup.switch
        rows.addWidget(startup)
        divider = QFrame()
        divider.setObjectName("divider")
        divider.setFixedHeight(1)
        rows.addWidget(divider)

        supports_tray = os.name == "nt"
        tray_setting = SettingRow("Close to system tray", "Keep the companion running in the background.", "tray",
                                  checked=supports_tray and read_settings().get("minimizeOnClose") is True,
                                  enabled=supports_tray)
        tray_setting.switch.clicked.connect(self.save_close_behavior)
        self.close_to_tray = tray_setting.switch
        rows.addWidget(tray_setting)
        body.addWidget(settings)

        footer = QFrame()
        footer.setObjectName("footer")
        footer.setMinimumWidth(570)
        actions = QHBoxLayout(footer)
        actions.setContentsMargins(20, 10, 20, 10)
        actions.setSpacing(8)
        self.update_message = label(name="version")
        self.update_message.setWordWrap(True)
        self.update_message.setFixedWidth(185)
        actions.addWidget(self.update_message)
        self.update_button = QPushButton()
        self.update_button.clicked.connect(self.run_update_action)
        actions.addWidget(self.update_button)
        actions.addStretch()
        folder = QPushButton(QIcon(str(ASSETS / "ui/folder.svg")), "League folder…")
        folder.clicked.connect(self.choose_folder)
        actions.addWidget(folder)
        quit_button = QPushButton("Quit")
        quit_button.clicked.connect(lambda: server.request_stop())
        actions.addWidget(quit_button)
        outer.addWidget(footer)

        self.tray = QSystemTrayIcon(icon, self)
        self.tray.setToolTip(title)
        self.tray_menu = QMenu(self)
        self.tray_menu.addAction("Open DraftEdge Companion", self.restore)
        self.tray_menu.addAction("Quit", lambda: server.request_stop())
        self.tray.setContextMenu(self.tray_menu)
        self.tray.activated.connect(self.tray_activated)
        self.refresh_timer = QTimer(self)
        self.refresh_timer.timeout.connect(self.refresh)
        self.refresh_timer.start(300)
        self.refresh()

    def save_startup(self, enabled):
        try:
            set_start_with_windows(self.startup_command, enabled)
        except OSError:
            self.startup.setChecked(not enabled)
            QMessageBox.critical(self, self.windowTitle(), "Could not change the Windows startup setting.")

    def save_close_behavior(self, enabled):
        try:
            update_settings(minimizeOnClose=enabled)
        except OSError:
            self.close_to_tray.setChecked(not enabled)
            QMessageBox.critical(self, self.windowTitle(), "Could not save the window setting.")

    def choose_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Choose the League of Legends install folder")
        if folder:
            try:
                update_settings(leagueFolder=folder)
            except OSError:
                QMessageBox.critical(self, self.windowTitle(), "Could not save the League folder.")
                return
            self.poller.preferred = Path(folder)

    def closeEvent(self, event):
        if self.stop.is_set():
            event.accept()
            return
        event.ignore()
        if not self.close_to_tray.isChecked():
            self.server.request_stop()
        elif self.tray.isSystemTrayAvailable():
            self.tray.show()
            self.hide()
        else:
            QMessageBox.warning(self, self.windowTitle(), "The system tray is unavailable. The companion window is still open.")

    def restore(self):
        if not self.stop.is_set():
            self.showNormal()
            self.raise_()
            self.activateWindow()
            self.tray.hide()

    def tray_activated(self, reason):
        if reason in (QSystemTrayIcon.ActivationReason.Trigger, QSystemTrayIcon.ActivationReason.DoubleClick):
            self.restore()

    def refresh(self):
        if self.stop.is_set():
            self.refresh_timer.stop()
            self.tray.hide()
            QApplication.instance().quit()
            return
        if self.activation is not None and self.activation.requested():
            self.restore()
        value = self.server.state.read()
        connection = (value["status"], value["message"])
        if connection != self.last_connection:
            self.last_connection = connection
            self.update_connection(*connection)
        update = value["update"]
        if update != self.last_update:
            self.last_update = update
            self.render_update(update)

    def update_connection(self, status, message):
        connected = status in {"connected", "champ_select", "unsupported_draft"}
        if connected:
            title, detail = "Connected to League", message
        elif status == "connection_error":
            title, detail = "Could not connect to League", message
        else:
            title = message
            detail = ("Open the League client to connect." if status == "waiting_client"
                      else "Looking for the League client.")
        self.connection_title.setText(title)
        self.connection_detail.setText(detail)
        self.connection.setProperty("connected", connected)
        self.connection.style().unpolish(self.connection)
        self.connection.style().polish(self.connection)

    def render_update(self, update):
        status = update["status"]
        text = {
            "not_checked": "Checking for updates…",
            "checking": "Checking for updates…",
            "current": "Up to date",
            "downloading": "Downloading update…",
            "installing": "Installing update…",
            "install_failed": "Could not start update",
            "disabled": "Update check off",
        }.get(status, "Update check unavailable")
        button = ""
        self.update_action = None
        if status == "available":
            text = f"v{update['latestVersion']} available"
            if self.updates.can_install(update):
                button, self.update_action = "Update", lambda: self.updates.install(update)
            else:
                button, self.update_action = "Download update", lambda: webbrowser.open(update["downloadUrl"])
        elif status == "install_failed":
            button, self.update_action = "Retry update", lambda: self.updates.install(update)
        elif status == "unavailable":
            button, self.update_action = "Retry", self.updates.start
        self.update_message.setText(f"v{self.updates.current_version} · {text}")
        self.update_button.setText(button)
        self.update_button.setVisible(bool(button))

    def run_update_action(self):
        if self.update_action is not None:
            self.update_action()


def launcher(server, poller, stop, updates, title="DraftEdge Companion", *, activation=None):
    app = QApplication([sys.argv[0]])
    app.setApplicationName("DraftEdge Companion")
    app.setQuitOnLastWindowClosed(False)
    app.setStyle("Fusion")
    app.styleHints().setColorScheme(Qt.ColorScheme.Dark)
    app.setStyleSheet((ASSETS / "ui/launcher.qss").read_text(encoding="utf-8").replace("@ui", (ASSETS / "ui").as_posix()))
    icon = QIcon(str(APP_ICON))
    app.setWindowIcon(icon)
    window = LauncherWindow(server, poller, stop, updates, title, activation, icon)
    window.show()
    try:
        app.exec()
    finally:
        window.tray.hide()
