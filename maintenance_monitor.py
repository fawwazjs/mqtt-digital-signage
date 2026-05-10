import json
import time
from common import MqttNode
from colorama import Fore, Style


class MaintenanceMonitor(MqttNode):
    def __init__(self):
        super().__init__(client_id="monitor-main", node_type="MONITOR", color=Fore.BLUE)
        self.screens = {}

    def start(self):
        self.connect()
        self.subscribe("$share/maintenance-group/display/+/status", qos=1)
        self.subscribe("display/+/health", qos=1)
        self.log(f"{Style.BRIGHT}Monitoring screen fleet...{Style.RESET_ALL}")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            payload = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.log(f"Malformed message on {topic}: {exc}", color=Fore.RED)
            return

        parts = topic.split("/")
        display_id = parts[-2] if len(parts) >= 2 else "unknown"

        if parts[-1] == "status":
            status = payload.get("status", "unknown")
            self.screens[display_id] = payload
            if status == "offline":
                self.log(f"{Fore.RED}{Style.BRIGHT}[OFFLINE] {display_id}{Style.RESET_ALL}", category="LWT")
                self._alert(display_id, "Display offline via LWT")
            else:
                self.log(f"{Fore.LIGHTBLACK_EX}Status: {display_id} → {status}{Style.RESET_ALL}", category="SUB")

        elif parts[-1] == "health":
            self.screens[display_id] = payload
            status = payload.get("status", "unknown")
            temp = payload.get("temp", "--")
            self.log(f"{Fore.LIGHTBLACK_EX}{display_id} heartbeat: {status} | Temp: {temp}°C{Style.RESET_ALL}", category="SUB")

    def _alert(self, display_id, reason):
        self.log(f"Maintenance alert → maintenance/{display_id}/alert", category="PUB")
        payload = json.dumps({
            "display_id": display_id,
            "reason": reason,
            "timestamp": time.time(),
        })
        self.publish(f"maintenance/{display_id}/alert", payload, qos=1)


if __name__ == "__main__":
    monitor = MaintenanceMonitor()
    monitor.start()