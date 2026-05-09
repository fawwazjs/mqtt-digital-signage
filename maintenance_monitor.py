import time
import json
from common import MqttNode

class MaintenanceMonitor(MqttNode):
    def __init__(self):
        super().__init__(client_id="maintenance-monitor")
        self.screens = {}

    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        # Subscribe to health reports (including those from LWT)
        self.client.subscribe("health/+")
        
        # Subscribe to state requests (Request-Response Pattern)
        self.client.subscribe("request/status")
        
        print("[Maintenance] Monitoring screen fleet health...")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = json.loads(msg.payload.decode())
        
        if topic.startswith("health/"):
            screen_id = topic.split("/")[1]
            status = payload.get("status", "unknown")
            self.screens[screen_id] = payload
            print(f"[Maintenance] Screen {screen_id} status: {status}")
            if status == "offline":
                print(f"[!!! ALERT !!!] Screen {screen_id} has gone DARK!")
        
        elif topic == "request/status":
            # Handle Request-Response
            screen_id = payload.get("screen_id")
            print(f"[Maintenance] Received state request from {screen_id}")
            
            # Check for properties
            response_topic = None
            correlation_data = None
            if msg.properties:
                if hasattr(msg.properties, 'ResponseTopic'):
                    response_topic = msg.properties.ResponseTopic
                if hasattr(msg.properties, 'CorrelationData'):
                    correlation_data = msg.properties.CorrelationData
            
            if response_topic:
                print(f"[Maintenance] Sending response to {response_topic}")
                response_payload = json.dumps({
                    "content": "Current Global Promo",
                    "server_time": time.time(),
                    "status": "synchronized"
                })
                self.publish(
                    response_topic, 
                    response_payload, 
                    correlation_data=correlation_data
                )

if __name__ == "__main__":
    monitor = MaintenanceMonitor()
    monitor.start()
