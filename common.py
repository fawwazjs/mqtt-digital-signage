import time
import json
import uuid
from paho.mqtt import client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

class MqttNode:
    def __init__(self, client_id, clean_session=True, receive_maximum=20):
        self.client_id = client_id
        # Use MQTT v5
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=mqtt.MQTTv5)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_publish = self.on_publish
        self.client.on_subscribe = self.on_subscribe
        
        self.receive_maximum = receive_maximum
        self.connected = False

    def connect(self, host="localhost", port=1883, keepalive=60, last_will=None):
        # Set Last Will Testament (LWT) if provided
        if last_will:
            # last_will should be a dict: {"topic": str, "payload": str, "qos": int, "retain": bool}
            self.client.will_set(
                last_will["topic"], 
                payload=last_will["payload"], 
                qos=last_will.get("qos", 1), 
                retain=last_will.get("retain", True)
            )

        # MQTT 5 Connect Properties
        properties = Properties(PacketTypes.CONNECT)
        properties.ReceiveMaximum = self.receive_maximum
        
        print(f"[{self.client_id}] Connecting to {host}:{port}...")
        self.client.connect(host, port, keepalive, clean_start=True, properties=properties)
        self.client.loop_start()

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            print(f"[{self.client_id}] Connected successfully.")
            self.connected = True
        else:
            print(f"[{self.client_id}] Connection failed with code {reason_code}")

    def on_message(self, client, userdata, msg):
        # To be overridden
        user_props = {}
        if msg.properties:
            # Extract User Properties if they exist
            if hasattr(msg.properties, 'UserProperty'):
                for key, value in msg.properties.UserProperty:
                    user_props[key] = value
        
        print(f"[{self.client_id}] Received on {msg.topic}: {msg.payload.decode()} (QoS {msg.qos}, Retain {msg.retain})")
        if user_props:
            print(f"[{self.client_id}]   User Properties: {user_props}")

    def on_publish(self, client, userdata, mid, reason_code, properties):
        pass

    def on_subscribe(self, client, userdata, mid, reason_codes, properties):
        print(f"[{self.client_id}] Subscribed (mid: {mid})")

    def publish(self, topic, payload, qos=0, retain=False, user_properties=None, expiry=None, response_topic=None, correlation_data=None):
        properties = Properties(PacketTypes.PUBLISH)
        
        if user_properties:
            # user_properties should be a list of tuples: [("key", "value"), ...]
            properties.UserProperty = user_properties
            
        if expiry:
            # expiry in seconds
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
