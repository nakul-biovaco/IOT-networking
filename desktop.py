"""
Native Windows Desktop Application Launcher for IoT Network Health & Security Monitor.
Launches the system in a standalone, borderless/native desktop window without browser bars.
Supports:
1. Native pywebview (WinForms/WebView2 native window)
2. Standalone Windows Desktop App Window (--app mode via Edge/Chrome)
"""

import os
import sys
import time
import subprocess
import threading
import urllib.request
import urllib.error

# Ensure project root is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from app import app
from database.db import init_db
from core.scheduler import start_workers, stop_workers
from config import FLASK_HOST, FLASK_PORT


def start_flask_server():
    """Starts the Flask server in a dedicated daemon thread."""
    init_db()

    # Start mDNS service advertisement
    try:
        from app import start_mdns_service
        start_mdns_service()
    except Exception:
        pass

    start_workers()

    # Use Waitress if available, else Flask dev server
    try:
        from waitress import serve
        serve(app, host="127.0.0.1", port=FLASK_PORT, threads=8, channel_timeout=120)
    except ImportError:
        app.run(host="127.0.0.1", port=FLASK_PORT, debug=False, use_reloader=False, threaded=True)


def wait_for_server(url, timeout=10):
    """Waits until the local server responds with HTTP 200."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            req = urllib.request.urlopen(url, timeout=1)
            if req.getcode() == 200:
                return True
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.3)
    return False


class DesktopApi:
    """Python bridge exposed to JavaScript inside pywebview desktop window."""
    __slots__ = ()

    def toggle_fullscreen(self):
        try:
            import webview
            if webview.windows:
                w = webview.windows[0]
                w.toggle_fullscreen()
                return bool(getattr(w, "fullscreen", False))
        except Exception:
            pass
        return False

    def maximize(self):
        try:
            import webview
            if webview.windows:
                webview.windows[0].maximize()
                return True
        except Exception:
            pass
        return False

    def restore(self):
        try:
            import webview
            if webview.windows:
                webview.windows[0].restore()
                return True
        except Exception:
            pass
        return False

    def is_fullscreen(self):
        try:
            import webview
            if webview.windows:
                return bool(getattr(webview.windows[0], "fullscreen", False))
        except Exception:
            pass
        return False


def launch_native_window():
    server_url = f"http://127.0.0.1:{FLASK_PORT}"

    # 1. Start Flask in background thread
    server_thread = threading.Thread(target=start_flask_server, daemon=True, name="flask-server")
    server_thread.start()

    print("[DESKTOP] Initializing IoT Network Monitoring Engine...")
    ready = wait_for_server(server_url, timeout=12)
    if not ready:
        print("[ERROR] Failed to start local server backend.")
        return

    print(f"[DESKTOP] Server active on {server_url}. Opening Native Windows Desktop App...")

    # 2. Try pywebview if installed
    try:
        import webview
        api = DesktopApi()
        app_url = f"{server_url}/?nocache={int(time.time())}"
        window = webview.create_window(
            title="IoT Network Health & Security Monitoring System",
            url=app_url,
            width=1400,
            height=880,
            min_size=(1050, 720),
            resizable=True,
            frameless=False,
            easy_drag=True,
            text_select=True,
            maximized=True,
            js_api=api,
        )
        webview.start(gui="edgechromium", debug=False)
        print("[DESKTOP] Native window closed by user.")
        stop_workers()
        return
    except (ImportError, Exception) as e:
        print(f"[DESKTOP] pywebview note: {e}. Using Native Windows Standalone App Window...")

    # 3. Native Windows App Mode (Edge / Chrome Standalone App Window)
    # This runs a 100% native Windows window with no tabs, no address bar, no browser controls.
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]

    edge_bin = None
    for p in edge_paths:
        if os.path.exists(p):
            edge_bin = p
            break

    if edge_bin:
        profile_dir = os.path.join(BASE_DIR, ".desktop_profile")
        cmd = [
            edge_bin,
            f"--app={server_url}/?nocache={int(time.time())}",
            f"--user-data-dir={profile_dir}",
            "--start-maximized",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--app-auto-launched",
        ]
        print(f"[DESKTOP] Launching native standalone window: {' '.join(cmd)}")
        proc = subprocess.Popen(cmd)
        try:
            proc.wait()
        except KeyboardInterrupt:
            proc.terminate()
        print("[DESKTOP] Desktop application window closed.")
        stop_workers()
    else:

        # Fallback to system default
        import webbrowser
        webbrowser.open(server_url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            stop_workers()


if __name__ == "__main__":
    launch_native_window()
