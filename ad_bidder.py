import time
import json
import random
from common import MqttNode
from colorama import Fore, Style

class AdBidder(MqttNode):
    def __init__(self):
        super().__init__(client_id="ad-bidder-engine", node_type="BIDDER", color=Fore.GREEN)
        self.zones = ["Lobby", "Gate", "FoodCourt"]
        
    def start(self):
        self.connect()
        brands = ["Rolex", "Nike", "Coca-Cola", "Samsung", "Apple"]
        
        self.log("Starting Real-time Bidding Engine...")
        try:
            while True:
                # Randomly wait before a flash bid occurs
                time.sleep(random.randint(20, 40))
                
                zone = random.choice(self.zones)
                brand = random.choice(brands)
                price = round(random.uniform(10.0, 50.0), 2)
                
                topic = f"display/zone/{zone}/content"
                payload = json.dumps({
                    "content": f"PREMIUM AD: {brand} (Bid: ${price})",
                    "timestamp": time.time()
                })
                
                user_props = [
                    ("campaign_id", f"RTB_{brand.upper()}"),
                    ("content_type", "video"),
                    ("duration", "10") # Short duration ad
                ]
                
                self.log(f"High Bid Won! Overriding {Fore.YELLOW}{zone}{Style.RESET_ALL} with {Fore.CYAN}{brand}{Style.RESET_ALL} for ${price}")
                
                # QoS 1, Retain True to overwrite the current schedule temporarily
                self.publish(topic, payload, qos=1, retain=True, user_properties=user_props)
                
        except KeyboardInterrupt:
            self.stop()

if __name__ == "__main__":
    bidder = AdBidder()
    bidder.start()
