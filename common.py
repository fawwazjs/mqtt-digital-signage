import threading
from datetime import datetime
from paho.mqtt import client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties
from colorama import init, Fore, Style

init(autoreset=True, strip=False)

CONNECT_TIMEOUT_SECONDS = 10

_CATEGORY_COLORS = {
    "PUB":  Fore.CYAN,
    "SUB":  Fore.GREEN,
    "CONN": Fore.BLUE,
    "DISC": Fore.YELLOW,
    "LWT":  Fore.RED,
}


class MqttNode:
    def __init__(self, client_id, node_type="NODE", color=Fore.WHITE, receive_maximum=20):
        self.client_id = client_id
        self.node_type = node_type
        self.color = color
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=mqtt.MQTTv5)
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        self.client.on_publish = self.on_publish
        self.client.on_subscribe = self.on_subscribe
        self.receive_maximum = receive_maximum
        self.connected = False
        self._connect_event = threading.Event()

    def log(self, message, color=None, category=None):
        c = color if color else self.color
        ts = datetime.now().strftime("%H:%M:%S")
        if category:
            cat_c = _CATEGORY_COLORS.get(category, Fore.WHITE)
            cat_tag = f" {Style.BRIGHT}{cat_c}[{category}]{Style.RESET_ALL}"
        else:
            cat_tag = ""
        print(
            f"{Style.DIM}{c}[{self.node_type}|{self.client_id}]{Style.RESET_ALL} "
            f"{Style.DIM}{ts}{Style.RESET_ALL}{cat_tag} {message}",
            flush=True,
        )

    def connect(self, host="localhost", port=1883, keepalive=60, last_will=None, clean_start=True):
        if last_will:
            self.client.will_set(
                last_will["topic"],
                payload=last_will["payload"],
                qos=last_will.get("qos", 1),
                retain=last_will.get("retain", True),
            )

        properties = Properties(PacketTypes.CONNECT)
        properties.ReceiveMaximum = self.receive_maximum

        self.log(f"Connecting to broker {host}:{port}...")
        self._connect_event.clear()
        self.client.connect(host, port, keepalive, clean_start=clean_start, properties=properties)
        self.client.loop_start()

        self._connect_event.wait(timeout=CONNECT_TIMEOUT_SECONDS)
        if not self.connected:
            self.client.loop_stop()
            raise ConnectionError(f"Broker {host}:{port} unreachable within {CONNECT_TIMEOUT_SECONDS}s")

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            self.connected = True
            self.log(f"{Fore.GREEN}Connected to broker.{Style.RESET_ALL}", category="CONN")
        else:
            self.log(f"{Fore.RED}Connection refused: code {reason_code}{Style.RESET_ALL}", category="CONN")
        self._connect_event.set()

    def on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties=None):
        self.connected = False
        self.log(f"{Fore.YELLOW}Disconnected (reason: {reason_code}){Style.RESET_ALL}", category="DISC")

    def on_message(self, client, userdata, msg):
        pass

    def on_publish(self, client, userdata, mid, reason_code, properties):
        pass

    def on_subscribe(self, client, userdata, mid, reason_codes, properties):
        self.log(f"{Fore.CYAN}Subscribed (mid: {mid}){Style.RESET_ALL}")

    def subscribe(self, topic, qos=0):
        self.log(f"Subscribing to {Fore.CYAN}{topic}{Style.RESET_ALL} (QoS {qos})", category="SUB")
        return self.client.subscribe(topic, qos)

    def publish(self, topic, payload, qos=0, retain=False, user_properties=None, expiry=None, response_topic=None, correlation_data=None):
        properties = Properties(PacketTypes.PUBLISH)
        if user_properties:
            properties.UserProperty = user_properties
        if expiry:
            properties.MessageExpiryInterval = expiry
        if response_topic:
            properties.ResponseTopic = response_topic
        if correlation_data:
            properties.CorrelationData = correlation_data
        return self.client.publish(topic, payload, qos=qos, retain=retain, properties=properties)

    def stop(self):
        self.client.disconnect()
        self.client.loop_stop()