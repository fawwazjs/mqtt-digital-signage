import os
import subprocess
import sys
import threading
import time

GROUPS = {
    "backend": [
        {"name": "MONITOR",  "cmd": [sys.executable, "maintenance_monitor.py"]},
        {"name": "WORKER-1", "cmd": [sys.executable, "analytics_worker.py", "1"]},
        {"name": "WORKER-2", "cmd": [sys.executable, "analytics_worker.py", "2"]},
    ],
    "screens": [
        {"name": "ITS01", "cmd": [sys.executable, "screen_client.py", "ITS01", "Graha"]},
        {"name": "ITS02", "cmd": [sys.executable, "screen_client.py", "ITS02", "Library"]},
        {"name": "ITS03", "cmd": [sys.executable, "screen_client.py", "ITS03", "Research"]},
        {"name": "ITS04", "cmd": [sys.executable, "screen_client.py", "ITS04", "Canteen"]},
    ],
    "publishers": [
        {"name": "SCHEDULER", "cmd": [sys.executable, "scheduler.py"]},
        {"name": "WEATHER",   "cmd": [sys.executable, "weather_updater.py"]},
        {"name": "BIDDER",    "cmd": [sys.executable, "ad_bidder.py"]},
    ],
    "utils": [
        {"name": "DB-LOG", "cmd": [sys.executable, "db_logger.py"]},
    ],
}

_ENV = {**os.environ, "PYTHONUNBUFFERED": "1"}


def _stream(proc, name):
    try:
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            if line:
                print(line, flush=True)
    except OSError as e:
        print(f"[LAUNCHER] Read error from {name}: {e}", flush=True)
    finally:
        proc.stdout.close()
        rc = proc.wait()
        if rc not in (0, -15):  # -15 = SIGTERM (clean shutdown)
            print(f"[LAUNCHER] {name} exited with code {rc}", flush=True)


def run_group(group_name):
    services = GROUPS.get(group_name)
    if not services:
        print(f"[LAUNCHER] Unknown group: '{group_name}'. Available: {', '.join(GROUPS)}")
        sys.exit(1)

    # Sever stdin — pane is output-only
    try:
        fd = os.open(os.devnull, os.O_RDONLY)
        os.dup2(fd, 0)
        os.close(fd)
    except OSError:
        pass

    procs = []
    for svc in services:
        try:
            proc = subprocess.Popen(
                svc["cmd"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=_ENV,
            )
            procs.append((svc["name"], proc))
            threading.Thread(target=_stream, args=(proc, svc["name"]), daemon=True).start()
        except FileNotFoundError:
            print(f"[LAUNCHER] ERROR: script not found for {svc['name']}", flush=True)
        except OSError as e:
            print(f"[LAUNCHER] ERROR starting {svc['name']}: {e}", flush=True)

    if not procs:
        print(f"[LAUNCHER] No services started in group '{group_name}'", flush=True)
        return

    try:
        while any(p.poll() is None for _, p in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for _, p in procs:
            if p.poll() is None:
                p.terminate()
        for _, p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()


if __name__ == "__main__":
    run_group(sys.argv[1] if len(sys.argv) > 1 else "backend")
