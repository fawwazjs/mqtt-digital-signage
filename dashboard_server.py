#!/usr/bin/env python3
"""Dashboard server — MQTT→WebSocket relay + static file serving (Service 7)."""

import asyncio
import http.server
import json
import re
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import paho.mqtt.client as mqtt
from websockets.asyncio.server import serve

MQTT_HOST = "localhost"
MQTT_PORT = 1883
WS_PORT   = 8765
HTTP_PORT = 8080

_DASHBOARD_DIR = Path(__file__).parent / "dashboard"
_UPLOAD_DIR = _DASHBOARD_DIR / "uploads"
_MANIFEST = _UPLOAD_DIR / "manifest.json"
_MAX_UPLOAD_BYTES = 250 * 1024 * 1024
_ALLOWED_MIME = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "text/html": ".html",
}

_MQTT_TOPICS = [
    ("display/+/health",            0),
    ("display/+/status",            1),
    ("alert/#",                     2),
    ("analytics/zone/+/viewership", 0),
    ("content/zone/+/schedule",     1),
    ("content/display/+/override",  1),
    ("maintenance/+/alert",         1),
]

_ws_clients: set     = set()
_snapshot:   dict    = {}   # topic → last envelope
_loop:       asyncio.AbstractEventLoop | None = None
_mqttc:      mqtt.Client | None = None


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ── HTTP static server ─────────────────────────────────────────────────────

def _serve_http() -> None:
    class _H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(_DASHBOARD_DIR), **kw)

        def log_message(self, *_):
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            super().end_headers()

        def do_GET(self):
            if self.path == "/api/content/library":
                self._json(_read_manifest())
                return
            super().do_GET()

        def do_POST(self):
            if self.path != "/api/content/upload":
                self.send_error(404)
                return
            try:
                item = _handle_upload(self)
            except ValueError as exc:
                self._json({"error": str(exc)}, status=400)
                return
            self._json(item, status=201)

        def _json(self, payload, status=200):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    with http.server.HTTPServer(("", HTTP_PORT), _H) as srv:
        srv.serve_forever()


def _read_manifest() -> list[dict]:
    if not _MANIFEST.exists():
        return []
    try:
        return json.loads(_MANIFEST.read_text())
    except (OSError, json.JSONDecodeError):
        return []


def _write_manifest(items: list[dict]) -> None:
    _UPLOAD_DIR.mkdir(exist_ok=True)
    _MANIFEST.write_text(json.dumps(items, indent=2))


def _handle_upload(handler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > _MAX_UPLOAD_BYTES:
        raise ValueError("Invalid upload size.")
    content_type = handler.headers.get("Content-Type", "")
    match = re.search(r"boundary=([^;]+)", content_type)
    if not match:
        raise ValueError("Missing multipart boundary.")

    boundary = ("--" + match.group(1).strip('"')).encode()
    body = handler.rfile.read(length)
    file_part = None
    for part in body.split(boundary):
        if b'Content-Disposition:' in part and b'name="file"' in part:
            file_part = part
            break
    if not file_part:
        raise ValueError("Missing file field.")

    header_blob, _, data = file_part.partition(b"\r\n\r\n")
    if not data:
        raise ValueError("Empty upload.")
    data = data.rstrip(b"\r\n-")
    headers = header_blob.decode("utf-8", errors="replace")
    filename_match = re.search(r'filename="([^"]+)"', headers)
    mime_match = re.search(r"Content-Type:\s*([^\r\n]+)", headers, flags=re.I)
    original = unquote(filename_match.group(1)) if filename_match else "upload.bin"
    mime = (mime_match.group(1).strip().lower() if mime_match else "application/octet-stream")
    if mime not in _ALLOWED_MIME:
        raise ValueError("Unsupported file type.")

    safe_base = re.sub(r"[^a-zA-Z0-9._-]+", "-", Path(original).stem).strip("-") or "media"
    ext = _ALLOWED_MIME[mime]
    media_id = f"media-{uuid.uuid4().hex[:10]}"
    stored = f"{media_id}-{safe_base}{ext}"
    _UPLOAD_DIR.mkdir(exist_ok=True)
    target = _UPLOAD_DIR / stored
    target.write_bytes(data)

    item = {
        "id": media_id,
        "name": Path(original).stem,
        "type": "Video" if mime.startswith("video/") else "Image" if mime.startswith("image/") else "HTML",
        "duration": "custom",
        "size": f"{len(data) / (1024 * 1024):.1f} MB",
        "date": datetime.now(timezone.utc).date().isoformat(),
        "url": f"/uploads/{stored}",
        "mime": mime,
        "filename": original,
    }
    items = [item, *_read_manifest()]
    _write_manifest(items[:200])
    return item


# ── MQTT callbacks ─────────────────────────────────────────────────────────

def _on_connect(client, userdata, flags, rc, props):
    if rc.is_failure:
        print(f"[dashboard] MQTT connect failed: {rc}", flush=True)
        return
    for topic, qos in _MQTT_TOPICS:
        client.subscribe(topic, qos=qos)
    print(f"[dashboard] MQTT ready — {len(_MQTT_TOPICS)} topic patterns active.", flush=True)


def _on_disconnect(client, userdata, flags, rc, props):
    print(f"[dashboard] MQTT disconnected: {rc}", flush=True)


def _on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return

    user_props = {}
    if msg.properties and getattr(msg.properties, "UserProperty", None):
        user_props = dict(msg.properties.UserProperty)

    envelope = {
        "type":            "mqtt_message",
        "topic":           msg.topic,
        "payload":         payload,
        "qos":             msg.qos,
        "retained":        bool(msg.retain),
        "user_properties": user_props,
        "timestamp":       _ts(),
    }
    _snapshot[msg.topic] = envelope

    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_broadcast(envelope), _loop)


# ── WebSocket server ───────────────────────────────────────────────────────

async def _broadcast(msg: dict) -> None:
    if not _ws_clients:
        return
    data = json.dumps(msg)
    await asyncio.gather(*(c.send(data) for c in set(_ws_clients)), return_exceptions=True)


async def _ws_handler(ws) -> None:
    _ws_clients.add(ws)
    try:
        await ws.send(json.dumps({
            "type":     "state_snapshot",
            "messages": list(_snapshot.values()),
        }))
        async for raw in ws:
            try:
                req = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if req.get("type") == "mqtt_publish" and _mqttc:
                topic   = req.get("topic", "")
                payload = req.get("payload", {})
                qos     = int(req.get("qos", 1))
                retain  = bool(req.get("retain", False))
                if topic:
                    _mqttc.publish(topic, json.dumps(payload), qos=qos, retain=retain)
    except Exception:
        pass
    finally:
        _ws_clients.discard(ws)


# ── Entry point ────────────────────────────────────────────────────────────

async def _main() -> None:
    global _loop, _mqttc

    _loop = asyncio.get_running_loop()

    threading.Thread(target=_serve_http, daemon=True).start()

    _mqttc = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="dashboard-server-1",
    )
    _mqttc.on_connect    = _on_connect
    _mqttc.on_disconnect = _on_disconnect
    _mqttc.on_message    = _on_message
    _mqttc.connect(MQTT_HOST, MQTT_PORT)
    _mqttc.loop_start()

    print(f"[dashboard] HTTP → http://localhost:{HTTP_PORT}", flush=True)
    print(f"[dashboard] WS   → ws://localhost:{WS_PORT}", flush=True)

    async with serve(_ws_handler, "localhost", WS_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print("\n[dashboard] Stopped.", flush=True)
