import time
import json
import random
import sys
from common import MqttNode
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

class ScreenClient(MqttNode):
    def __init__(self, screen_id, zone_id):
        super().__init__(client_id=f"screen-{screen_id}")
        self.screen_id = screen_id
        self.zone_id = zone_id
        self.current_content = "Default Logo"
        
    def start(self):
        # Last Will Testament: Set status to offline if disconnected unexpectedly
        lwt = {
            "topic": f"health/{self.screen_id}",
            "payload": json.dumps({"status": "offline", "reason": "LWT"}),
            "qos": 1,
            "retain": True
        }
        
        self.connect(last_will=lwt)
        
        # Wait for connection
        while not self.connected:
            time.sleep(0.1)
            
        # Subscribe to topics using wildcards
        # 1. Content for this specific screen or its zone
        self.client.subscribe(f"display/{self.screen_id}/#")
        self.client.subscribe(f"display/zone/{self.zone_id}/#")
        # 2. Emergency alerts
        self.client.subscribe("alert/#")
        # 3. Response for state requests
        self.client.subscribe(f"response/{self.screen_id}")
        
        # Initial State Request (Request-Response Pattern)
        self.request_initial_state()
        
        # Start periodic tasks
        try:
            while True:
                self.send_health_report()
                self.send_analytics()
                time.sleep(10)
        except KeyboardInterrupt:
            self.stop()

    def request_initial_state(self):
        print(f"[{self.client_id}] Requesting initial state...")
        # Request-Response pattern using properties
        self.publish(
            "request/status",
            payload=json.dumps({"screen_id": self.screen_id}),
            response_topic=f"response/{self.screen_id}",
            correlation_data=self.screen_id.encode(),
            user_properties=[("request-type", "init")]
        )

    def send_health_report(self):
        # Demonstrate Topic Alias (saving bandwidth on repeated topics)
        # Note: Paho handles topic alias under the hood if configured, 
        # but we can also set it manually in properties for clarity in this demo.
        properties = Properties(PacketTypes.PUBLISH)
        properties.TopicAlias = 1 
        
        payload = json.dumps({
            "status": "online",
            "temp": random.randint(40, 65),
            "cpu": random.randint(10, 80),
            "memory": random.randint(200, 500),
            "uptime": int(time.time())
        })
        
        # First time we send the topic, subsequent times we could just send the alias
        # but paho 2.0 manages this if we use the same topic.
        self.client.publish(f"health/{self.screen_id}", payload, qos=1, retain=True, properties=properties)

    def send_analytics(self):
        # QoS 0: Non-critical analytics
        payload = json.dumps({
            "screen_id": self.screen_id,
            "zone_id": self.zone_id,
            "viewer_count": random.randint(0, 50),
            "timestamp": time.time()
        })
        self.publish(f"analytics/{self.zone_id}", payload, qos=0)

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = json.loads(msg.payload.decode())
        
        if "alert" in topic:
            print(f"\n[!!! EMERGENCY ALERT !!!] {payload['message']}")
            print(f"Priority: {payload.get('priority', 'HIGH')}\n")
        elif "content" in topic:
            self.current_content = payload.get("content", "Unknown")
            print(f"[{self.client_id}] Updating content to: {self.current_content}")
            if msg.properties:
                print(f"[{self.client_id}] Meta: {msg.properties.UserProperty}")
        elif topic.startswith("response/"):
            print(f"[{self.client_id}] Received response from controller: {payload}")
            if "content" in payload:
                self.current_content = payload["content"]

if __name__ == "__main__":
    s_id = sys.argv[1] if len(sys.argv) > 1 else "A101"
    z_id = sys.argv[2] if len(sys.argv) > 2 else "Lobby"
    client = ScreenClient(s_id, z_id)
    client.start()
