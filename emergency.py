import time
import json
import sys
from common import MqttNode
from colorama import Fore, Style

class EmergencySystem(MqttNode):
    def __init__(self):
        super().__init__(client_id="emergency-system", node_type="EMERGENCY", color=Fore.RED)
        
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
        
        expiry = 3600 
        
        self.log(f"{Style.BRIGHT}{Fore.RED}!!! BROADCASTING CRITICAL ALERT !!!{Style.RESET_ALL}")
        self.log(f"Message: {message}")
        
        self.publish(topic, payload, qos=2, retain=False, expiry=expiry)
        
        time.sleep(2)
        self.stop()

if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "FIRE EVACUATION IMMEDIATELY"
    system = EmergencySystem()
    system.start(msg)
