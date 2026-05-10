import time
import json
from common import MqttNode
from colorama import Fore, Style

class MaintenanceMonitor(MqttNode):
    def __init__(self):
        super().__init__(client_id="monitor-main", node_type="MONITOR", color=Fore.BLUE)
        self.screens = {}

    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        self.client.subscribe("health/+")
        self.client.subscribe("request/status")
        
        self.log(f"{Style.BRIGHT}Monitoring screen fleet health...{Style.RESET_ALL}")
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
            
            if status == "offline":
                self.log(f"{Fore.RED}{Style.BRIGHT}[!!! ALERT !!!] Screen {screen_id} has gone DARK!{Style.RESET_ALL}")
            else:
                self.log(f"{Fore.LIGHTBLACK_EX}Screen {screen_id} heartbeat: {status} | Temp: {payload.get('temp')}°C{Style.RESET_ALL}")
        
        elif topic == "request/status":
            screen_id = payload.get("screen_id")
            self.log(f"{Fore.YELLOW}Received Sync Request from {screen_id}{Style.RESET_ALL}")
            
            response_topic = None
            correlation_data = None
            if msg.properties:
                if hasattr(msg.properties, 'ResponseTopic'):
                    response_topic = msg.properties.ResponseTopic
                if hasattr(msg.properties, 'CorrelationData'):
                    correlation_data = msg.properties.CorrelationData
            
            if response_topic:
                self.log(f"  -> Replying to {response_topic}...")
                response_payload = json.dumps({
                    "content": "Global Default: Welcome!",
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
