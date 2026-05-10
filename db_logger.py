import time
import json
from common import MqttNode
from colorama import Fore, Style

class DatabaseLogger(MqttNode):
    def __init__(self):
        super().__init__(client_id="db-logger-sink", node_type="DB-LOG", color=Fore.LIGHTMAGENTA_EX)
        self.message_count = 0

    def start(self):
        self.connect()
        while not self.connected:
            time.sleep(0.1)
            
        # Subscribe to literally EVERYTHING on the broker
        self.log(f"Subscribing to {Fore.YELLOW}#{Style.RESET_ALL} (All Topics) for DB persistence...")
        self.client.subscribe("#", qos=2)
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stop()

    def on_message(self, client, userdata, msg):
        self.message_count += 1
        
        # Don't log every single heartbeat to terminal to avoid noise, just log a summary occasionally
        # but do log interesting things
        topic = msg.topic
        
        if topic.startswith("$SYS/"):
            return # Ignore broker internal stats
            
        if "health" in topic or "analytics" in topic:
            if self.message_count % 20 == 0:
                self.log(f"[{self.message_count} messages saved] ...DB Syncing...")
        else:
            try:
                payload = msg.payload.decode()
                # Truncate long payloads for terminal display
                if len(payload) > 50:
                    payload = payload[:47] + "..."
                self.log(f"SAVED -> Topic: {Fore.CYAN}{topic}{Style.RESET_ALL} | Data: {payload}")
            except:
                self.log(f"SAVED -> Topic: {Fore.CYAN}{topic}{Style.RESET_ALL} | Data: [Binary]")

if __name__ == "__main__":
    logger = DatabaseLogger()
    logger.start()
