import time
import json
import sys
from common import MqttNode
from colorama import Fore, Style

class ContentScheduler(MqttNode):
    def __init__(self):
        super().__init__(client_id="scheduler-1", node_type="SCHEDULER", color=Fore.MAGENTA)
        
    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        campaigns = [
            {"id": "CAMP_MORNING", "content": "Good Morning! Get 20% off Coffee ☕", "type": "image", "duration": 15, "target": "zone/Lobby"},
            {"id": "CAMP_LUNCH", "content": "Lunch Special: Burger + Fries 🍔", "type": "video", "duration": 30, "target": "zone/Lobby"},
            {"id": "CAMP_GATE", "content": "Flight GA-100 Boarding Now ✈️", "type": "html", "duration": 60, "target": "B201"},
            {"id": "CAMP_GENERAL", "content": "Welcome to the Mall! Enjoy your stay 🛍️", "type": "image", "duration": 20, "target": "zone/Lobby"}
        ]
        
        self.log("Starting content broadcast loop...")
        try:
            index = 0
            while True:
                camp = campaigns[index % len(campaigns)]
                self.publish_content(camp["target"], camp)
                index += 1
                time.sleep(8) # Wait 8 seconds between scheduling
        except KeyboardInterrupt:
            self.log(f"{Fore.YELLOW}Shutting down scheduler...{Style.RESET_ALL}")
            self.stop()

    def publish_content(self, target, campaign):
        topic = f"display/{target}/content"
        payload = json.dumps({
            "content": campaign["content"],
            "timestamp": time.time()
        })
        
        user_props = [
            ("campaign_id", campaign["id"]),
            ("content_type", campaign["type"]),
            ("duration", str(campaign["duration"]))
        ]
        
        self.log(f"Pushing Campaign {Fore.YELLOW}{campaign['id']}{Style.RESET_ALL} -> Target: {Fore.CYAN}{target}{Style.RESET_ALL}")
        self.log(f"  Content: '{campaign['content']}'")
        
        self.publish(topic, payload, qos=1, retain=True, user_properties=user_props)

if __name__ == "__main__":
    scheduler = ContentScheduler()
    scheduler.start()
