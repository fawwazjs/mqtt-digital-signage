import json
import sys
import time
from common import MqttNode
from colorama import Fore, Style

PROCESSING_DELAY_SECONDS = 0.3


class AnalyticsWorker(MqttNode):
    def __init__(self, worker_id):
        super().__init__(client_id=f"worker-{worker_id}", node_type="WORKER", color=Fore.LIGHTYELLOW_EX)
        self.worker_id = worker_id

    def start(self):
        self.connect()
        self.subscribe("$share/analytics-processors/analytics/zone/+/viewership", qos=0)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.log(f"Malformed analytics message: {exc}", color=Fore.RED)
            return
        screen_id = payload.get("screen_id", "unknown")
        zone_id = payload.get("zone_id", "unknown")
        viewers = payload.get("viewer_count", 0)
        self.log(f"Processing → Screen: {Fore.GREEN}{screen_id}{Style.RESET_ALL} | Zone: {zone_id} | Viewers: {viewers}", category="SUB")
        time.sleep(PROCESSING_DELAY_SECONDS)


if __name__ == "__main__":
    w_id = sys.argv[1] if len(sys.argv) > 1 else "1"
    worker = AnalyticsWorker(w_id)
    worker.start()