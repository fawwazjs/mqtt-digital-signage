import time
import json
import sys
from common import MqttNode

class EmergencySystem(MqttNode):
    def __init__(self):
        super().__init__(client_id="emergency-system")
        
    def start(self, message="FIRE EVACUATION IMMEDIATELY"):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        topic = "alert/critical"
        payload = json.dumps({
            "message": message,
            "priority": "CRITICAL",
            "timestamp": time.time()
        })
        
        # MQTT 5.0 Features:
        # QoS 2: Exactly once delivery (Critical for emergencies)
        # Message Expiry: Alerts shouldn't be delivered if screens are offline for > 1 hour
        expiry = 3600 
        
        print(f"[Emergency] BROADCASTING CRITICAL ALERT: {message}")
        self.publish(topic, payload, qos=2, retain=False, expiry=expiry)
        
        # Keep alive for a bit to ensure delivery
        time.sleep(2)
        self.stop()

if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "FIRE EVACUATION IMMEDIATELY"
    system = EmergencySystem()
    system.start(msg)
