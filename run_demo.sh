#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker &>/dev/null; then
    echo "ERROR: docker not installed." >&2
    exit 1
fi

echo "Starting MQTT broker..."
docker compose up -d

echo "Waiting for broker on port 1883..."
until nc -z localhost 1883 2>/dev/null; do
    sleep 1
done
echo "Broker ready."

source .venv/bin/activate
python tui.py
