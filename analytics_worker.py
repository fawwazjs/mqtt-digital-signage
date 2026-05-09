import time
import json
import sys
from common import MqttNode

class AnalyticsWorker(MqttNode):
    def __init__(self, worker_id):
        super().__init__(client_id=f"analytics-worker-{worker_id}")
        self.worker_id = worker_id

    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        # MQTT 5.0 Shared Subscription
        # Format: $share/<group_name>/<topic_filter>
        shared_topic = "$share/analytics-processors/analytics/#"
        
        print(f"[Worker-{self.worker_id}] Joining shared subscription: {shared_topic}")
        self.client.subscribe(shared_topic)
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def on_message(self, client, userdata, msg):
        payload = json.loads(msg.payload.decode())
        print(f"[Worker-{self.worker_id}] Processing analytics from {payload['screen_id']} in {payload['zone_id']}")
        # Simulate processing time
        time.sleep(0.5)

if __name__ == "__main__":
    w_id = sys.argv[1] if len(sys.argv) > 1 else "1"
    worker = AnalyticsWorker(w_id)
    worker.start()
