import json
import random
import sys
import time
from common import MqttNode
from colorama import Fore, Style
from deployment_data import DISPLAYS, ZONE_TYPES

REPORT_INTERVAL_SECONDS = 10


class ScreenClient(MqttNode):
    def __init__(self, screen_id, zone_id):
        color = random.choice([Fore.LIGHTBLUE_EX, Fore.LIGHTGREEN_EX, Fore.LIGHTYELLOW_EX])
        super().__init__(client_id=f"screen-{screen_id}", node_type="DISPLAY", color=color)
        self.screen_id = screen_id
        self.zone_id = zone_id
        self.current_content = "Default Logo"

    def start(self):
        lwt = {
            "topic": f"display/{self.screen_id}/status",
            "payload": json.dumps({"status": "offline", "screen_id": self.screen_id, "reason": "LWT"}),
            "qos": 1,
            "retain": True,
        }
        self.log(f"Registering LWT on display/{self.screen_id}/status", category="LWT")
        self.connect(last_will=lwt)

        self.subscribe(f"content/zone/{self.zone_id}/schedule", qos=1)
        self.subscribe(f"content/display/{self.screen_id}/override", qos=1)
        self.subscribe("alert/network/#", qos=2)
        self.subscribe(f"alert/zone/{self.zone_id}/#", qos=2)
        self.subscribe(f"display/{self.screen_id}/response/playlist", qos=1)
        self.subscribe(f"environment/{self.zone_id}/weather", qos=0)

        self._request_playlist()

        try:
            while True:
                self._send_health()
                self._send_analytics()
                self.log(f"Displaying: [{Fore.CYAN}{self.current_content}{Style.RESET_ALL}]")
                time.sleep(REPORT_INTERVAL_SECONDS)
        except KeyboardInterrupt:
            self.stop()

    def _request_playlist(self):
        self.log("Requesting current playlist from scheduler...", category="PUB")
        self.publish(
            f"display/{self.screen_id}/request/playlist",
            payload=json.dumps({"screen_id": self.screen_id}),
            qos=1,
            response_topic=f"display/{self.screen_id}/response/playlist",
            correlation_data=self.screen_id.encode(),
        )

    def _send_health(self):
        payload = json.dumps({
            "status": "online",
            "screen_id": self.screen_id,
            "temp": random.randint(40, 65),
            "cpu": random.randint(10, 80),
            "memory": random.randint(200, 500),
            "uptime": int(time.time()),
        })
        self.publish(f"display/{self.screen_id}/health", payload, qos=0, retain=True)
        self.log(f"{Fore.LIGHTBLACK_EX}Health report sent.{Style.RESET_ALL}", category="PUB")

    def _send_analytics(self):
        zone_base = {"Graha": 35, "Library": 22, "Research": 18, "Canteen": 48}.get(self.zone_id, 20)
        viewers = max(0, int(random.gauss(zone_base, 12)))
        peak = "peak" if 7 <= time.localtime().tm_hour < 20 else "off_peak"
        payload = json.dumps({
            "screen_id": self.screen_id,
            "zone_id": self.zone_id,
            "viewer_count": viewers,
            "dwell_time": random.randint(5, 120),
            "peak_period": peak,
            "timestamp": time.time(),
        })
        user_props = [
            ("zone_type", ZONE_TYPES.get(self.zone_id, "campus")),
            ("time_bucket", peak),
            ("confidence_score", "0.85"),
        ]
        self.publish(f"analytics/zone/{self.zone_id}/viewership", payload, qos=0, user_properties=user_props)
        self.log(f"{Fore.LIGHTBLACK_EX}Analytics sent (viewers: {viewers}).{Style.RESET_ALL}", category="PUB")

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            payload = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.log(f"Malformed message on {topic}: {exc}", color=Fore.RED)
            return

        parts = topic.split("/")

        if parts[0] == "alert":
            self._handle_alert(payload)
        elif parts[0] == "content":
            self._handle_content(payload, msg)
        elif parts[0] == "display" and len(parts) >= 3 and parts[-1] == "playlist":
            self._handle_playlist_response(payload)
        elif parts[-1] == "weather":
            temp = payload.get("temperature", "--")
            cond = payload.get("condition", "Unknown")
            self.log(f"{Fore.BLUE}Weather: {temp}°C, {cond}{Style.RESET_ALL}")

    def _handle_alert(self, payload):
        if payload.get("status") == "cleared":
            self.log(f"{Fore.GREEN}Alert cleared — resuming normal content.{Style.RESET_ALL}", category="SUB")
            self.current_content = "Default Logo"
            return
        message = payload.get("message", "Emergency")
        self.log(f"\n{Fore.RED}{Style.BRIGHT}=========================================", category="SUB")
        self.log(f"{Fore.RED}{Style.BRIGHT}[!!! EMERGENCY ALERT !!!]")
        self.log(f"{Fore.RED}{Style.BRIGHT}MESSAGE : {message}")
        self.log(f"{Fore.RED}{Style.BRIGHT}SEVERITY: {payload.get('severity', 'CRITICAL')}")
        self.log(f"{Fore.RED}{Style.BRIGHT}========================================={Style.RESET_ALL}\n")
        self.current_content = f"EMERGENCY: {message}"

    def _handle_content(self, payload, msg):
        self.current_content = payload.get("content", "Unknown")
        self.log(f"{Fore.GREEN}Content updated:{Style.RESET_ALL} {Fore.CYAN}'{self.current_content}'{Style.RESET_ALL}", category="SUB")
        if msg.properties and hasattr(msg.properties, "UserProperty"):
            props = dict(msg.properties.UserProperty)
            self.log(f"  Metadata: {Fore.LIGHTMAGENTA_EX}{props}{Style.RESET_ALL}")

    def _handle_playlist_response(self, payload):
        playlist = payload.get("playlist", [])
        self.log(f"Playlist received: {len(playlist)} campaigns.", category="SUB")
        if playlist:
            self.current_content = playlist[0].get("content", "Unknown")
            self.log(f"First campaign loaded: {Fore.CYAN}'{self.current_content}'{Style.RESET_ALL}")


if __name__ == "__main__":
    s_id = sys.argv[1] if len(sys.argv) > 1 else DISPLAYS[0]["id"]
    z_id = sys.argv[2] if len(sys.argv) > 2 else DISPLAYS[0]["zone"]
    client = ScreenClient(s_id, z_id)
    client.start()
