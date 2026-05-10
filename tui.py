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
from datetime import datetime

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# ── Config ────────────────────────────────────────────────────────────────────

_PY  = sys.executable
_ENV = {**os.environ, "PYTHONUNBUFFERED": "1"}

SERVICES = [
    {"name": "monitor",    "cmd": [_PY, "maintenance_monitor.py"]},
    {"name": "worker-1",   "cmd": [_PY, "analytics_worker.py", "1"]},
    {"name": "worker-2",   "cmd": [_PY, "analytics_worker.py", "2"]},
    {"name": "screen-A101","cmd": [_PY, "screen_client.py", "A101", "Lobby"]},
    {"name": "screen-A102","cmd": [_PY, "screen_client.py", "A102", "Lobby"]},
    {"name": "screen-B201","cmd": [_PY, "screen_client.py", "B201", "Gate"]},
    {"name": "screen-C301","cmd": [_PY, "screen_client.py", "C301", "FoodCourt"]},
    {"name": "scheduler",  "cmd": [_PY, "scheduler.py"]},
    {"name": "weather",    "cmd": [_PY, "weather_updater.py"]},
    {"name": "bidder",     "cmd": [_PY, "ad_bidder.py"]},
    {"name": "db-logger",  "cmd": [_PY, "db_logger.py"]},
]

_PANEL_COLOR = {
    "worker": "cyan", "monitor": "yellow", "display": "green",
    "weather": "blue", "bidder": "magenta", "scheduler": "bright_white",
    "pub": "cyan", "sub": "green", "log": "white",
}
_PANEL_TITLE = {
    "worker": "ANALYTICS WORKERS", "monitor": "DISPLAY MONITOR",
    "display": "NOW DISPLAYING",   "weather": "WEATHER SERVICE",
    "bidder": "AD BIDDER",         "scheduler": "CONTENT SCHEDULER",
    "pub": "PUBLISH EVENTS",       "sub": "SUBSCRIBE EVENTS",
    "log": "SYSTEM LOG",
}
_SVC_COLOR = {
    "MONITOR": "blue", "WORKER": "yellow", "DISPLAY": "green",
    "WEATHER": "cyan", "BIDDER": "magenta", "SCHEDULER": "bright_white",
}

# ── ANSI Utilities ────────────────────────────────────────────────────────────

_STRIP_ALL = re.compile(r'\x1b\[[0-9;]*[A-Za-z]|\x1b.')
_STRIP_CSI = re.compile(               # remove cursor/erase/private; keep SGR (*m)
    r'\x1b\[[0-9;]*[ABCDEFGHJKSTfnsu]'
    r'|\x1b\[[?][0-9;]*[hl]'
    r'|\x1b[^\[]'
)

def _clean(s):   return _STRIP_ALL.sub('', s)
def _sanitize(s): return _STRIP_CSI.sub('', s)

# ── Log Parser ────────────────────────────────────────────────────────────────

_LOG_RE = re.compile(
    r'^\s*\[([A-Z][A-Z0-9-]*)\|([^\]]+)\]\s+\d{2}:\d{2}:\d{2}'
    r'(?:\s+\[([A-Z]+)\])?\s*(.*)'
)

def _parse(raw):
    m = _LOG_RE.match(_clean(raw).strip())
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3) or "", m.group(4)  # node, id, cat, msg

# ── Shared State ──────────────────────────────────────────────────────────────

_lock   = threading.Lock()
_bufs   = {k: deque(maxlen=500) for k in _PANEL_COLOR}
_mstate = {}   # display_id → {status, temp, ts}
_dstate = {}   # client_id  → {content, ts}

# ── State Parsers ─────────────────────────────────────────────────────────────

_HB_RE   = re.compile(r'(\w+)\s+heartbeat:\s+(\w+)\s*\|\s*Temp:\s*(\d+)')
_OFF_RE  = re.compile(r'\[OFFLINE\]\s+(\w+)')
_STAT_RE = re.compile(r'Status:\s+(\w+)\s+[→>]\s+(\w+)')
_DISP_RE = re.compile(r'Displaying:\s+\[(.+)\]')

def _upd_monitor(msg):
    m = _HB_RE.search(msg)
    if m:
        sid, status, temp = m.group(1), m.group(2), int(m.group(3))
        with _lock:
            _mstate.setdefault(sid, {})
            _mstate[sid].update({"status": status, "temp": temp, "ts": datetime.now().strftime("%H:%M:%S")})
        return
    m = _OFF_RE.search(msg)
    if m:
        sid = m.group(1)
        with _lock:
            _mstate.setdefault(sid, {})
            _mstate[sid].update({"status": "offline", "ts": datetime.now().strftime("%H:%M:%S")})
        return
    m = _STAT_RE.search(msg)
    if m:
        sid, status = m.group(1), m.group(2)
        with _lock:
            _mstate.setdefault(sid, {})
            _mstate[sid].update({"status": status, "ts": datetime.now().strftime("%H:%M:%S")})

def _upd_display(cid, msg):
    m = _DISP_RE.search(msg)
    if m:
        with _lock:
            _dstate[cid] = {"content": _clean(m.group(1)), "ts": datetime.now().strftime("%H:%M:%S")}

# ── Message Router ────────────────────────────────────────────────────────────

def _route(node, cid, cat, msg, raw):
    targets = {"log"}

    if node == "MONITOR":
        targets.add("monitor");  _upd_monitor(msg)
    elif node == "WORKER":
        targets.add("worker")
    elif node == "DISPLAY":
        _upd_display(cid, msg)
        if "Displaying:" in msg:
            targets.add("display")
    elif node in ("WEATHER", "BIDDER", "SCHEDULER"):
        targets.add(node.lower())

    if cat == "PUB":   targets.add("pub")
    elif cat == "SUB": targets.add("sub")

    with _lock:
        for t in targets:
            _bufs[t].append(raw)

# ── Service Manager ────────────────────────────────────────────────────────────

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
                _route(*parsed, line)
            else:
                with _lock:
                    _bufs["log"].append(line)
    except OSError:
        pass
    finally:
        rc = proc.wait()
        if rc not in (0, -15):
            with _lock:
                _bufs["log"].append(f"[LAUNCHER] {name} exited (code {rc})")

def start_services():
    for svc in SERVICES:
        try:
            p = subprocess.Popen(svc["cmd"], stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=_ENV)
            _procs.append(p)
            threading.Thread(target=_stream, args=(p, svc["name"]), daemon=True).start()
        except FileNotFoundError:
            with _lock: _bufs["log"].append(f"[LAUNCHER] not found: {svc['name']}")
        except OSError as e:
            with _lock: _bufs["log"].append(f"[LAUNCHER] {svc['name']}: {e}")

def stop_services():
    _stop.set()
    for p in _procs:
        if p.poll() is None: p.terminate()
    for p in _procs:
        try:    p.wait(timeout=5)
        except subprocess.TimeoutExpired: p.kill(); p.wait()

# ── Renderers ─────────────────────────────────────────────────────────────────

def _text(name, n):
    with _lock: lines = list(_bufs[name])[-n:]
    out = Text()
    for line in lines:
        out.append_text(Text.from_ansi(_sanitize(line)))
        out.append("\n")
    return out

def _event_text(name, n, sym):
    """PUB/SUB panels with colored service prefix symbol."""
    with _lock: lines = list(_bufs[name])[-n:]
    out = Text()
    for line in lines:
        clean = _clean(line).strip()
        m = _LOG_RE.match(clean)
        col = _SVC_COLOR.get(m.group(1), "white") if m else "white"
        out.append(f" {sym} ", style=f"bold {col}")
        out.append_text(Text.from_ansi(_sanitize(line)))
        out.append("\n")
    return out

def _render_monitor(n):
    with _lock: states = dict(_mstate)
    if not states:
        return _text("monitor", n)

    t = Table.grid(padding=(0, 1), expand=True)
    t.add_column("ID",   style="bold",  min_width=5)
    t.add_column("Status",              min_width=10)
    t.add_column("Temp",                min_width=7)
    t.add_column("Last",  style="dim",  min_width=8)

    for sid in sorted(states):
        s       = states[sid]
        status  = s.get("status", "unknown")
        temp    = s.get("temp")
        ts      = s.get("ts", "--:--:--")

        if status == "offline":
            st  = Text("● OFFLINE", style="bold red")
            ids = "bold red"
        elif status == "error":
            st  = Text("● ERROR",   style="bold red")
            ids = "bold red"
        elif status in ("online", "rendering"):
            st  = Text("● ONLINE",  style="bold green")
            ids = "white"
        else:
            st  = Text(f"● {status.upper()}", style="dim")
            ids = "dim"

        if temp is None:
            tmp = Text("--", style="dim")
        elif temp > 60:
            tmp = Text(f"{temp}°C ▲", style="bold red")
        elif temp > 50:
            tmp = Text(f"{temp}°C !", style="bold yellow")
        else:
            tmp = Text(f"{temp}°C",   style="green")

        t.add_row(Text(sid, style=ids), st, tmp, Text(ts))
    return t

def _render_display():
    with _lock: states = dict(_dstate)
    if not states:
        return Text("Waiting for displays…", style="dim")

    t = Table.grid(padding=(0, 1), expand=True)
    t.add_column("Screen", style="bold cyan", min_width=6)
    t.add_column("Content",                   min_width=20)
    t.add_column("At",     style="dim",        min_width=8)

    for cid in sorted(states):
        s       = states[cid]
        content = s.get("content", "?")[:48]
        ts      = s.get("ts", "--:--:--")
        short   = cid.replace("screen-", "")

        ct = Text(content, style="bold red" if "EMERGENCY" in content else "white")
        t.add_row(Text(short, style="bold cyan"), ct, Text(ts))
    return t

def _panel(name, content):
    col = _PANEL_COLOR[name]
    return Panel(content,
                 title=f"[bold {col}]{_PANEL_TITLE[name]}[/bold {col}]",
                 title_align="right",
                 border_style=col,
                 padding=(0, 1))

# ── Layout Builders ───────────────────────────────────────────────────────────

def _page1(h):
    sm = max(3, (h - 4) * 2 // 7 - 2)
    lg = max(5, (h - 4) * 3 // 7 - 2)

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

    lay["worker"].update(_panel("worker",    _text("worker",    sm)))
    lay["monitor"].update(_panel("monitor",  _render_monitor(sm)))
    lay["display"].update(_panel("display",  _render_display()))
    lay["weather"].update(_panel("weather",  _text("weather",   sm)))
    lay["bidder"].update(_panel("bidder",    _text("bidder",    sm)))
    lay["scheduler"].update(_panel("scheduler", _text("scheduler", sm)))
    lay["pub"].update(_panel("pub",  _event_text("pub", lg, "⬆")))
    lay["sub"].update(_panel("sub",  _event_text("sub", lg, "⬇")))
    return lay

def _page2(h):
    return _panel("log", _text("log", max(10, h - 6)))

# ── Status Bar ────────────────────────────────────────────────────────────────

def _statusbar(page):
    t = Text()
    for i, name in enumerate(["DASHBOARD", "LOGS"]):
        style = "bold black on white" if i == page else "dim"
        t.append(f"  [{i+1}] {name}  ", style=style)
    t.append("    ")
    for key, desc in [("[Tab]","Switch Page"), ("[1][2]","Go To Page"),
                      ("[Q]","Quit"), ("[Ctrl+C]","Force Kill")]:
        t.append(key,  style="bold yellow")
        t.append(f" {desc}   ", style="dim")
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
                if select.select([sys.stdin], [], [], 0.05)[0]:
                    self._q.put(sys.stdin.read(1))
            except Exception:
                break

    def get(self):
        try: return self._q.get_nowait()
        except queue.Empty: return None

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    console = Console()
    signal.signal(signal.SIGINT,  lambda *_: _stop.set())
    signal.signal(signal.SIGTERM, lambda *_: _stop.set())

    with _lock: _bufs["log"].append("[TUI] Starting services…")
    start_services()

    kb   = _KB()
    kb.start()
    page = 0

    try:
        with Live(console=console, screen=True, refresh_per_second=4) as live:
            while not _stop.is_set():
                key = kb.get()
                if   key == '\t':         page = (page + 1) % 2
                elif key in ('q', 'Q'):   break
                elif key == '1':          page = 0
                elif key == '2':          page = 1

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
