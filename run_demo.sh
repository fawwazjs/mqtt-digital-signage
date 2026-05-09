#!/bin/bash

echo "🚀 Starting Digital Signage MQTT 5.0 Demo..."

# 1. Start Maintenance Monitor
./venv/bin/python3 -u maintenance_monitor.py > logs_maintenance.txt 2>&1 &
echo "✅ Maintenance Monitor started."

# 2. Start Analytics Workers (2 instances)
./venv/bin/python3 -u analytics_worker.py 1 > logs_worker1.txt 2>&1 &
./venv/bin/python3 -u analytics_worker.py 2 > logs_worker2.txt 2>&1 &
echo "✅ Analytics Workers (Shared Sub) started."

# 3. Start Screen Clients (3 instances in different zones)
./venv/bin/python3 -u screen_client.py A101 Lobby > logs_screen_A101.txt 2>&1 &
./venv/bin/python3 -u screen_client.py A102 Lobby > logs_screen_A102.txt 2>&1 &
./venv/bin/python3 -u screen_client.py B201 Gate > logs_screen_B201.txt 2>&1 &
echo "✅ Screen Clients started."

# 4. Start Content Scheduler
./venv/bin/python3 -u scheduler.py > logs_scheduler.txt 2>&1 &
echo "✅ Content Scheduler started."

# 5. Start Dashboard Server
echo "🌐 Starting Dashboard on http://localhost:8080"
cd dashboard && python3 -m http.server 8080
