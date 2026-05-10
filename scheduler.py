import json
import time
from common import MqttNode
from colorama import Fore, Style

SCHEDULE_INTERVAL_SECONDS = 8

CAMPAIGNS = [
    {"id": "CAMP_MORNING",  "content": "Good Morning! Get 20% off Coffee ☕", "type": "image", "duration": 15, "zone": "Lobby"},
    {"id": "CAMP_LUNCH",    "content": "Lunch Special: Burger + Fries 🍔",    "type": "video", "duration": 30, "zone": "Lobby"},
    {"id": "CAMP_GATE",     "content": "Flight GA-100 Boarding Now ✈️",       "type": "html",  "duration": 60, "display_id": "B201"},
    {"id": "CAMP_GENERAL",  "content": "Welcome to the Mall! Enjoy your stay 🛍️", "type": "image", "duration": 20, "zone": "Lobby"},
]


class ContentScheduler(MqttNode):
    def __init__(self):
        super().__init__(client_id="scheduler-1", node_type="SCHEDULER", color=Fore.MAGENTA)

    def start(self):
        self.connect()
        self.subscribe("display/+/request/playlist", qos=1)
        self.log("Starting content broadcast loop...")
        try:
            index = 0
            while True:
                self._publish_campaign(CAMPAIGNS[index % len(CAMPAIGNS)])
                index += 1
                time.sleep(SCHEDULE_INTERVAL_SECONDS)
        except KeyboardInterrupt:
            self.log(f"{Fore.YELLOW}Shutting down...{Style.RESET_ALL}")
            self.stop()

    def _publish_campaign(self, campaign):
        if "zone" in campaign:
            topic = f"content/zone/{campaign['zone']}/schedule"
        else:
            topic = f"content/display/{campaign['display_id']}/override"

        payload = json.dumps({
            "content": campaign["content"],
            "timestamp": time.time(),
        })
        user_props = [
            ("campaign_id", campaign["id"]),
            ("content_type", campaign["type"]),
            ("duration", str(campaign["duration"])),
        ]
        self.log(f"Campaign {Fore.YELLOW}{campaign['id']}{Style.RESET_ALL} → {Fore.CYAN}{topic}{Style.RESET_ALL}", category="PUB")
        self.publish(topic, payload, qos=1, retain=True, user_properties=user_props)

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.log(f"Malformed playlist request on {topic}: {exc}", color=Fore.RED)
            return

        if not msg.properties or not hasattr(msg.properties, "ResponseTopic"):
            self.log(f"Playlist request on {topic} missing ResponseTopic — ignored", color=Fore.YELLOW)
            return

        response_topic = msg.properties.ResponseTopic
        correlation_data = getattr(msg.properties, "CorrelationData", None)
        display_id = topic.split("/")[1] if len(topic.split("/")) >= 2 else "unknown"

        self.log(f"Playlist request from {Fore.CYAN}{display_id}{Style.RESET_ALL}", category="SUB")
        self.log(f"Sending playlist to {response_topic}", category="PUB")

        response_payload = json.dumps({
            "playlist": CAMPAIGNS,
            "timestamp": time.time(),
        })
        self.publish(response_topic, response_payload, qos=1, correlation_data=correlation_data)


if __name__ == "__main__":
    scheduler = ContentScheduler()
    scheduler.start()