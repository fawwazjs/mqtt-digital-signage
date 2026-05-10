import time
import json
import sys
from common import MqttNode
from colorama import Fore, Style

class AnalyticsWorker(MqttNode):
    def __init__(self, worker_id):
        super().__init__(client_id=f"worker-{worker_id}", node_type="WORKER", color=Fore.LIGHTYELLOW_EX)
        self.worker_id = worker_id

    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        shared_topic = "$share/analytics-processors/analytics/#"
        
        self.log(f"Joining Shared Subscription: {Fore.CYAN}{shared_topic}{Style.RESET_ALL}")
        self.client.subscribe(shared_topic)
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def on_message(self, client, userdata, msg):
        payload = json.loads(msg.payload.decode())
        self.log(f"Processing Data -> Screen: {Fore.GREEN}{payload['screen_id']}{Style.RESET_ALL} | Zone: {payload['zone_id']} | Viewers: {payload['viewer_count']}")
        time.sleep(0.3) # Simulate processing load

if __name__ == "__main__":
    w_id = sys.argv[1] if len(sys.argv) > 1 else "1"
    worker = AnalyticsWorker(w_id)
    worker.start()
