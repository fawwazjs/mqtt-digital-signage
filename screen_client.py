import time
import json
import random
import sys
from common import MqttNode
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties
from colorama import Fore, Style

class ScreenClient(MqttNode):
    def __init__(self, screen_id, zone_id):
        # Different colors for different screens just for visual appeal in terminal
        color = random.choice([Fore.LIGHTBLUE_EX, Fore.LIGHTGREEN_EX, Fore.LIGHTYELLOW_EX])
        super().__init__(client_id=f"screen-{screen_id}", node_type="SCREEN", color=color)
        self.screen_id = screen_id
        self.zone_id = zone_id
        self.current_content = "Default Logo"
        
    def start(self):
        lwt = {
            "topic": f"health/{self.screen_id}",
            "payload": json.dumps({"status": "offline", "reason": "LWT"}),
            "qos": 1,
            "retain": True
        }
        
        self.connect(last_will=lwt)
        
        while not self.connected:
            time.sleep(0.1)
            
        self.client.subscribe(f"display/{self.screen_id}/#")
        self.client.subscribe(f"display/zone/{self.zone_id}/#")
        self.client.subscribe("alert/#")
        self.client.subscribe(f"response/{self.screen_id}")
        self.client.subscribe(f"environment/{self.zone_id}/weather")
        
        self.request_initial_state()
        
        try:
            while True:
                self.send_health_report()
                self.send_analytics()
                # Print a neat "playing" status every loop
                self.log(f"Displaying: [{Fore.CYAN}{self.current_content}{Style.RESET_ALL}]")
                time.sleep(10)
        except KeyboardInterrupt:
            self.stop()

    def request_initial_state(self):
        self.log("Requesting initial state from controller...")
        self.publish(
            "request/status",
            payload=json.dumps({"screen_id": self.screen_id}),
            response_topic=f"response/{self.screen_id}",
            correlation_data=self.screen_id.encode(),
            user_properties=[("request-type", "init")]
        )

    def send_health_report(self):
        properties = Properties(PacketTypes.PUBLISH)
        properties.TopicAlias = 1 
        
        payload = json.dumps({
            "status": "online",
            "temp": random.randint(40, 65),
            "cpu": random.randint(10, 80),
            "memory": random.randint(200, 500),
            "uptime": int(time.time())
        })
        self.client.publish(f"health/{self.screen_id}", payload, qos=1, retain=True, properties=properties)
        self.log(f"{Fore.LIGHTBLACK_EX}Sent health report (Alias: 1){Style.RESET_ALL}")

    def send_analytics(self):
        viewers = random.randint(0, 50)
        payload = json.dumps({
            "screen_id": self.screen_id,
            "zone_id": self.zone_id,
            "viewer_count": viewers,
            "timestamp": time.time()
        })
        self.publish(f"analytics/{self.zone_id}", payload, qos=0)
        self.log(f"{Fore.LIGHTBLACK_EX}Sent analytics (Viewers: {viewers}){Style.RESET_ALL}")

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = json.loads(msg.payload.decode())
        
        if "alert" in topic:
            self.log(f"\n{Fore.RED}{Style.BRIGHT}=========================================")
            self.log(f"{Fore.RED}{Style.BRIGHT}[!!! EMERGENCY ALERT !!!]")
            self.log(f"{Fore.RED}{Style.BRIGHT}MESSAGE : {payload['message']}")
            self.log(f"{Fore.RED}{Style.BRIGHT}PRIORITY: {payload.get('priority', 'HIGH')}")
            self.log(f"{Fore.RED}{Style.BRIGHT}========================================={Style.RESET_ALL}\n")
            self.current_content = f"EMERGENCY: {payload['message']}"
            
        elif "content" in topic:
            self.current_content = payload.get("content", "Unknown")
            self.log(f"{Fore.GREEN}Content Updated!{Style.RESET_ALL} -> {Fore.CYAN}'{self.current_content}'{Style.RESET_ALL}")
            if msg.properties and hasattr(msg.properties, 'UserProperty'):
                props = {k: v for k, v in msg.properties.UserProperty}
                self.log(f"  Metadata: {Fore.LIGHTMAGENTA_EX}{props}{Style.RESET_ALL}")
                
        elif topic.startswith("response/"):
            self.log(f"Received sync response from controller.")
            if "content" in payload:
                self.current_content = payload["content"]
                self.log(f"Synced content: {Fore.CYAN}'{self.current_content}'{Style.RESET_ALL}")
                
        elif "weather" in topic:
            temp = payload.get("temperature", "--")
            cond = payload.get("condition", "Unknown")
            self.log(f"{Fore.BLUE}Weather Update for {self.zone_id}:{Style.RESET_ALL} {temp}°C, {cond}")

if __name__ == "__main__":
    s_id = sys.argv[1] if len(sys.argv) > 1 else "A101"
    z_id = sys.argv[2] if len(sys.argv) > 2 else "Lobby"
    client = ScreenClient(s_id, z_id)
    client.start()
