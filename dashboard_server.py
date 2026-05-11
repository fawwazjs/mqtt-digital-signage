#!/usr/bin/env python3
"""Dashboard server — MQTT→WebSocket relay + static file serving (Service 7)."""

import asyncio
import http.server
import json
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt
from websockets.asyncio.server import serve

MQTT_HOST = "localhost"
MQTT_PORT = 1883
WS_PORT   = 8765
HTTP_PORT = 8080

_DASHBOARD_DIR = Path(__file__).parent / "dashboard"

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

    with http.server.HTTPServer(("", HTTP_PORT), _H) as srv:
        srv.serve_forever()


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
