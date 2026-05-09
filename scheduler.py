import time
import json
import sys
from common import MqttNode

class ContentScheduler(MqttNode):
    def __init__(self):
        super().__init__(client_id="content-scheduler")
        
    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        # Example contents
        campaigns = [
            {"id": "C001", "content": "Welcome to the Mall", "type": "image", "duration": 30},
            {"id": "C002", "content": "Special Sale: 50% Off", "type": "video", "duration": 15},
            {"id": "C003", "content": "Flight Info: Delayed", "type": "html", "duration": 60}
        ]
        
        print("[Scheduler] Starting content broadcast loop...")
        try:
            while True:
                for camp in campaigns:
                    # Publish to all screens in Lobby
                    self.publish_content("zone/Lobby", camp)
                    time.sleep(5)
                    
                    # Publish to specific screen
                    self.publish_content("A101", camp)
                    time.sleep(5)
        except KeyboardInterrupt:
            self.stop()

    def publish_content(self, target, campaign):
        topic = f"display/{target}/content"
        payload = json.dumps({
            "content": campaign["content"],
            "timestamp": time.time()
        })
        
        # User Properties (MQTT 5.0)
        user_props = [
            ("campaign_id", campaign["id"]),
            ("content_type", campaign["type"]),
            ("duration", str(campaign["duration"]))
        ]
        
        print(f"[Scheduler] Publishing campaign {campaign['id']} to {target}")
        
        # QoS 1: Content updates must arrive
        # Retain: New screens joining get the current content
        self.publish(topic, payload, qos=1, retain=True, user_properties=user_props)

if __name__ == "__main__":
    scheduler = ContentScheduler()
    scheduler.start()
