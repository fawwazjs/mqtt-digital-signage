import time
import json
import random
from common import MqttNode
from colorama import Fore, Style

class WeatherUpdater(MqttNode):
    def __init__(self):
        super().__init__(client_id="weather-service-1", node_type="WEATHER", color=Fore.CYAN)
        self.zones = ["Lobby", "Gate", "FoodCourt", "Parking"]
        
    def start(self):
        self.connect()
        conditions = ["Sunny ☀️", "Cloudy ☁️", "Raining 🌧️", "Storm ⛈️"]
        
        self.log("Starting weather broadcast loop...")
        try:
            while True:
                zone = random.choice(self.zones)
                temp = random.randint(22, 35)
                cond = random.choice(conditions)
                
                topic = f"environment/{zone}/weather"
                payload = json.dumps({
                    "temperature": temp,
                    "condition": cond,
                    "timestamp": time.time()
                })
                
                self.log(f"Updating Weather for {Fore.YELLOW}{zone}{Style.RESET_ALL}: {temp}°C, {cond}")
                
                # Retain the weather so new screens immediately know it
                self.publish(topic, payload, qos=1, retain=True)
                
                time.sleep(15) # Publish every 15 seconds
        except KeyboardInterrupt:
            self.stop()

if __name__ == "__main__":
    weather = WeatherUpdater()
    weather.start()
