import json
import sys
import time
from common import MqttNode
from colorama import Fore, Style

ALERT_EXPIRY_SECONDS = 3600


class EmergencySystem(MqttNode):
    def __init__(self):
        super().__init__(client_id="emergency-system", node_type="EMERGENCY", color=Fore.RED)

    def broadcast(self, message, scope="network", scope_id="all", alert_type="fire", severity="critical"):
        self.connect()
        while not self.connected:
            time.sleep(0.1)

        topic = f"alert/{scope}/{scope_id}/emergency"
        payload = json.dumps({
            "message": message,
            "alert_type": alert_type,
            "severity": severity,
            "timestamp": time.time(),
        })
        user_props = [
            ("alert_type", alert_type),
            ("severity", severity),
            ("issuer", self.client_id),
            ("expiry_time", str(int(time.time()) + ALERT_EXPIRY_SECONDS)),
        ]

        self.log(f"{Style.BRIGHT}{Fore.RED}!!! BROADCASTING EMERGENCY ALERT !!!{Style.RESET_ALL}", category="PUB")
        self.log(f"Scope: {scope}/{scope_id} | Type: {alert_type} | Severity: {severity}")
        self.log(f"Message: {message}")

        msg_info = self.publish(
            topic, payload,
            qos=2, retain=True,
            expiry=ALERT_EXPIRY_SECONDS,
            user_properties=user_props,
        )
        try:
            msg_info.wait_for_publish(timeout=10)
        except RuntimeError:
            self.log("QoS 2 delivery unconfirmed after 10s.", color=Fore.YELLOW)
        except ValueError as exc:
            self.log(f"Publish failed: {exc}", color=Fore.RED)
        self.stop()

    def clear(self, scope="network", scope_id="all"):
        self.connect()
        while not self.connected:
            time.sleep(0.1)

        topic = f"alert/{scope}/{scope_id}/emergency"
        payload = json.dumps({"status": "cleared", "timestamp": time.time()})

        self.log(f"{Fore.GREEN}Clearing alert: {scope}/{scope_id}{Style.RESET_ALL}", category="PUB")

        msg_info = self.publish(topic, payload, qos=2, retain=True)
        try:
            msg_info.wait_for_publish(timeout=10)
        except RuntimeError:
            self.log("QoS 2 delivery unconfirmed after 10s.", color=Fore.YELLOW)
        except ValueError as exc:
            self.log(f"Publish failed: {exc}", color=Fore.RED)
        self.stop()


if __name__ == "__main__":
    system = EmergencySystem()
    if len(sys.argv) > 1 and sys.argv[1] == "--clear":
        _scope = sys.argv[2] if len(sys.argv) > 2 else "network"
        _scope_id = sys.argv[3] if len(sys.argv) > 3 else "all"
        system.clear(_scope, _scope_id)
    else:
        _msg = sys.argv[1] if len(sys.argv) > 1 else "FIRE EVACUATION IMMEDIATELY"
        _scope = sys.argv[2] if len(sys.argv) > 2 else "network"
        _scope_id = sys.argv[3] if len(sys.argv) > 3 else "all"
        _alert_type = sys.argv[4] if len(sys.argv) > 4 else "fire"
        _severity = sys.argv[5] if len(sys.argv) > 5 else "critical"
        system.broadcast(_msg, _scope, _scope_id, _alert_type, _severity)