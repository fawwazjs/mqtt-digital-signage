import time
import json
import uuid
from paho.mqtt import client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties
from colorama import init, Fore, Style

# Initialize colorama
init(autoreset=True)

class MqttNode:
    def __init__(self, client_id, node_type="NODE", color=Fore.WHITE, receive_maximum=20):
        self.client_id = client_id
        self.node_type = node_type
        self.color = color
        # Use MQTT v5
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=mqtt.MQTTv5)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_publish = self.on_publish
        self.client.on_subscribe = self.on_subscribe
        
        self.receive_maximum = receive_maximum
        self.connected = False

    def log(self, message, color=None):
        c = color if color else self.color
        print(f"{Style.BRIGHT}{c}[{self.node_type} | {self.client_id}]{Style.RESET_ALL} {message}")

    def connect(self, host="localhost", port=1883, keepalive=60, last_will=None):
        if last_will:
            self.client.will_set(
                last_will["topic"], 
                payload=last_will["payload"], 
                qos=last_will.get("qos", 1), 
                retain=last_will.get("retain", True)
            )

        properties = Properties(PacketTypes.CONNECT)
        properties.ReceiveMaximum = self.receive_maximum
        
        self.log(f"Connecting to broker {host}:{port}...")
        self.client.connect(host, port, keepalive, clean_start=True, properties=properties)
        self.client.loop_start()

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            self.log(f"{Fore.GREEN}Connected successfully to Broker.{Style.RESET_ALL}")
            self.connected = True
        else:
            self.log(f"{Fore.RED}Connection failed with code {reason_code}{Style.RESET_ALL}")

    def on_message(self, client, userdata, msg):
        pass # To be overridden

    def on_publish(self, client, userdata, mid, reason_code, properties):
        pass

    def on_subscribe(self, client, userdata, mid, reason_codes, properties):
        self.log(f"{Fore.CYAN}Subscribed successfully (mid: {mid}){Style.RESET_ALL}")

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

        msg_info = self.client.publish(topic, payload, qos=qos, retain=retain, properties=properties)
        return msg_info

    def stop(self):
        self.client.loop_stop()
        self.client.disconnect()
