#!/usr/bin/env python3
"""Digital Signage Network Controller — TUI Dashboard"""

import os
import queue
import re
import select
import signal
import subprocess
import sys
import termios
import threading
import time
import tty
from collections import deque

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.text import Text

# ── Config ────────────────────────────────────────────────────────────────────

_PY  = sys.executable
_ENV = {**os.environ, "PYTHONUNBUFFERED": "1"}

SERVICES = [
    {"name": "monitor",     "cmd": [_PY, "maintenance_monitor.py"]},
    {"name": "worker-1",    "cmd": [_PY, "analytics_worker.py", "1"]},
    {"name": "worker-2",    "cmd": [_PY, "analytics_worker.py", "2"]},
    {"name": "screen-A101", "cmd": [_PY, "screen_client.py", "A101", "Lobby"]},
    {"name": "screen-A102", "cmd": [_PY, "screen_client.py", "A102", "Lobby"]},
    {"name": "screen-B201", "cmd": [_PY, "screen_client.py", "B201", "Gate"]},
    {"name": "screen-C301", "cmd": [_PY, "screen_client.py", "C301", "FoodCourt"]},
    {"name": "scheduler",   "cmd": [_PY, "scheduler.py"]},
    {"name": "weather",     "cmd": [_PY, "weather_updater.py"]},
    {"name": "bidder",      "cmd": [_PY, "ad_bidder.py"]},
    {"name": "db-logger",   "cmd": [_PY, "db_logger.py"]},
    {"name": "dashboard",   "cmd": [_PY, "dashboard_server.py"]},
]

# ── Color Scheme ──────────────────────────────────────────────────────────────
# borders:      grey42  (uniform, unobtrusive)
# title label:  vibrant per panel
# timestamp:    grey70  (muted identifier)
# [CAT] tag:    vibrant by category
# message text: white   (readable)
# noise/dim:    grey70

_BORDER = "grey58"

_TITLE = {
    "worker":    "bright_cyan",
    "monitor":   "bright_yellow",
    "display":   "bright_green",
    "weather":   "bright_blue",
    "bidder":    "bright_magenta",
    "scheduler": "bright_white",
    "pub":       "bright_cyan",
    "sub":       "bright_green",
    "log":       "bright_white",
}

_CAT = {
    "PUB":  "bright_cyan",
    "SUB":  "bright_green",
    "CONN": "bright_yellow",
    "DISC": "bright_red",
    "LWT":  "bright_red",
}

_PANEL_META = {
    "worker":    ("ANALYTICS WORKERS", "analytics_worker.py"),
    "monitor":   ("SIGNAGE HEALTH",    "maintenance_monitor.py"),
    "display":   ("NOW DISPLAYING",    "screen_client.py"),
    "weather":   ("WEATHER SERVICE",   "weather_updater.py"),
    "bidder":    ("AD BIDDER",         "ad_bidder.py"),
    "scheduler": ("CONTENT SCHEDULER", "scheduler.py"),
    "pub":       ("PUBLISH EVENTS",    "screen_client.py"),
    "sub":       ("SUBSCRIBE EVENTS",  "screen_client.py"),
    "log":       ("SYSTEM LOG",        "db_logger.py · dashboard_server.py"),
}

# ── ANSI Utilities ────────────────────────────────────────────────────────────

_STRIP_ALL = re.compile(r'\x1b\[[0-9;]*[A-Za-z]|\x1b.')

def _clean(s): return _STRIP_ALL.sub('', s)

# ── Log Parser ────────────────────────────────────────────────────────────────

_LOG_RE = re.compile(
    r'^\s*\[([A-Z][A-Z0-9-]*)\|([^\]]+)\]\s+(\d{2}:\d{2}:\d{2})'
    r'(?:\s+\[([A-Z]+)\])?\s*(.*)'
)

def _parse(raw):
    m = _LOG_RE.match(_clean(raw).strip())
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3), m.group(4) or "", m.group(5)
    # (node, svc_id, timestamp, category, message)

# ── Shared State ──────────────────────────────────────────────────────────────
# Each buffer entry is a tuple: (node, svc_id, timestamp, category, message)

_lock = threading.Lock()
_bufs = {k: deque(maxlen=500) for k in _PANEL_META}

# ── Message Router ────────────────────────────────────────────────────────────

def _route(node, svc_id, ts, cat, msg):
    if node == "DB-LOG":
        target = "log"
    elif node == "MONITOR":
        target = "monitor"
    elif node == "WORKER":
        target = "worker"
    elif node == "DISPLAY":
        if "Displaying:" in msg:
            target = "display"
        elif cat == "PUB":
            target = "pub"
        else:
            target = "sub"
    elif node == "WEATHER":
        target = "weather"
    elif node == "BIDDER":
        target = "bidder"
    elif node == "SCHEDULER":
        target = "scheduler"
    else:
        target = "log"
    with _lock:
        _bufs[target].append((node, svc_id, ts, cat, msg))

# ── Service Manager ───────────────────────────────────────────────────────────

_procs = []
_stop  = threading.Event()

def _stream(proc, name):
    try:
        for raw in iter(proc.stdout.readline, b""):
            if _stop.is_set():
                break
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            if not line:
                continue
            parsed = _parse(line)
            if parsed:
                _route(*parsed)
            else:
                with _lock:
                    _bufs["log"].append(("SYS", name, "", "", _clean(line)))
    except OSError:
        pass
    finally:
        rc = proc.wait()
        if rc not in (0, -15):
            with _lock:
                _bufs["log"].append(("SYS", "launcher", "", "", f"{name} exited (code {rc})"))

def start_services():
    for svc in SERVICES:
        try:
            p = subprocess.Popen(svc["cmd"], stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=_ENV)
            _procs.append(p)
            threading.Thread(target=_stream, args=(p, svc["name"]), daemon=True).start()
        except FileNotFoundError:
            with _lock: _bufs["log"].append(("SYS", "launcher", "", "", f"not found: {svc['name']}"))
        except OSError as e:
            with _lock: _bufs["log"].append(("SYS", "launcher", "", "", f"{svc['name']}: {e}"))

def stop_services():
    _stop.set()
    for p in _procs:
        if p.poll() is None: p.terminate()
    for p in _procs:
        try:    p.wait(timeout=5)
        except subprocess.TimeoutExpired: p.kill(); p.wait()

# ── Renderers ─────────────────────────────────────────────────────────────────

_TEMP_SPLIT = re.compile(r'(\bonline\b|\boffline\b|Temp:\s*\d+\xb0C)', re.IGNORECASE)
_TEMP_VAL   = re.compile(r'Temp:\s*(\d+)\xb0C')

def _temp_color(deg):
    if deg >= 65: return "bright_red"
    if deg >= 55: return "red"
    if deg >= 45: return "yellow"
    return "green"

def _monitor_msg(t, msg):
    for chunk in _TEMP_SPLIT.split(msg):
        low = chunk.lower()
        if low == "online":
            t.append(chunk, style="bold bright_green")
        elif low == "offline":
            t.append(chunk, style="bold bright_red")
        else:
            m = _TEMP_VAL.match(chunk)
            if m:
                deg = int(m.group(1))
                t.append("Temp: ", style="bright_white")
                t.append(f"{m.group(1)}°C", style=f"bold {_temp_color(deg)}")
            else:
                t.append(chunk, style="bright_white")

def _render(panel, entry):
    node, svc_id, ts, cat, msg = entry
    t = Text(no_wrap=True, overflow="ellipsis")
    if ts:
        t.append(ts + " ", style="grey70")
    if cat:
        t.append(f"[{cat}] ", style=f"bold {_CAT.get(cat, 'bright_white')}")
    if panel == "monitor":
        _monitor_msg(t, msg)
    else:
        t.append(msg, style="bright_white")
    return t

def _text(panel, n):
    with _lock:
        entries = list(_bufs[panel])[-n:]
    out = Text()
    for entry in entries:
        out.append_text(_render(panel, entry))
        out.append("\n")
    return out

def _panel(name, content):
    label, fname = _PANEL_META[name]
    col = _TITLE[name]
    title = f"[bold {col}]{label}[/] [grey70]- {fname}[/grey70]"
    return Panel(content, title=title, title_align="left",
                 border_style=_BORDER, padding=(0, 0))

# ── Layout Builders ───────────────────────────────────────────────────────────

def _page1(h):
    # rows split 2:2:3; subtract 2 for top+bottom border per panel
    sm = max(2, h * 2 // 7 - 2)
    lg = max(3, h * 3 // 7 - 2)

    lay = Layout()
    lay.split_column(Layout(name="r1", ratio=2),
                     Layout(name="r2", ratio=2),
                     Layout(name="r3", ratio=3))
    lay["r1"].split_row(Layout(name="worker"),
                        Layout(name="monitor"),
                        Layout(name="display"))
    lay["r2"].split_row(Layout(name="weather"),
                        Layout(name="bidder"),
                        Layout(name="scheduler"))
    lay["r3"].split_row(Layout(name="pub"),
                        Layout(name="sub"))

    for name in ("worker", "monitor", "display", "weather", "bidder", "scheduler"):
        lay[name].update(_panel(name, _text(name, sm)))
    for name in ("pub", "sub"):
        lay[name].update(_panel(name, _text(name, lg)))
    return lay

def _page2(h):
    return _panel("log", _text("log", max(10, h - 4)))

# ── Status Bar ────────────────────────────────────────────────────────────────

def _statusbar(page):
    t = Text(no_wrap=True)
    for i, name in enumerate(["DASHBOARD", "LOGS"]):
        style = "bold black on white" if i == page else "grey70"
        t.append(f"  [{i+1}] {name}  ", style=style)
    t.append("   ")
    t.append("http://localhost:8080", style="bright_cyan")
    t.append("   ")
    for key, desc in [("Tab", "switch"), ("1/2", "jump"), ("Q", "quit"), ("^C", "kill")]:
        t.append(f" {key} ", style="bold bright_white on grey30")
        t.append(f" {desc}  ", style="grey70")
    return t

# ── Keyboard ──────────────────────────────────────────────────────────────────

class _KB:
    def __init__(self):
        self._q   = queue.Queue()
        self._fd  = sys.stdin.fileno()
        self._old = termios.tcgetattr(self._fd)

    def start(self):
        try: tty.setcbreak(self._fd)
        except Exception: pass
        threading.Thread(target=self._run, daemon=True).start()

    def restore(self):
        try: termios.tcsetattr(self._fd, termios.TCSADRAIN, self._old)
        except Exception: pass

    def _run(self):
        while not _stop.is_set():
            try:
                r, _, _ = select.select([sys.stdin], [], [], 0.1)
                if r:
                    data = os.read(self._fd, 32)
                    for b in data:
                        if b < 128:
                            self._q.put(chr(b))
            except (OSError, ValueError):
                time.sleep(0.05)

    def get(self):
        try: return self._q.get_nowait()
        except queue.Empty: return None

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    console = Console()
    signal.signal(signal.SIGINT,  lambda *_: _stop.set())
    signal.signal(signal.SIGTERM, lambda *_: _stop.set())

    with _lock: _bufs["log"].append(("TUI", "launcher", "", "", "Starting services…"))
    start_services()

    kb   = _KB()
    kb.start()
    page = 0

    try:
        with Live(console=console, screen=True, refresh_per_second=4) as live:
            while not _stop.is_set():
                key = kb.get()
                if   key == '\t':        page = (page + 1) % 2
                elif key in ('q', 'Q'): break
                elif key == '1':        page = 0
                elif key == '2':        page = 1

                h = console.height
                root = Layout()
                root.split_column(Layout(name="main"),
                                  Layout(name="bar", size=1))
                root["main"].update(_page1(h - 1) if page == 0 else _page2(h - 1))
                root["bar"].update(_statusbar(page))
                live.update(root)
                time.sleep(0.15)
    finally:
        kb.restore()
        stop_services()

if __name__ == "__main__":
    main()
