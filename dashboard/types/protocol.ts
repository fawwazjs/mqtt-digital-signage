export type Brand<TPrimitive, TBrand extends string> = TPrimitive & {
  readonly __brand: TBrand;
};

export type ISO8601Timestamp = Brand<string, "ISO8601Timestamp">;
export type UnixSeconds = Brand<number, "UnixSeconds">;

export type KnownDisplayId = "ITS01" | "ITS02" | "ITS03" | "ITS04";
export type KnownZoneId = "Graha" | "Library" | "Research" | "Canteen";
export type KnownBuildingId = "Graha ITS" | "ITS Library" | "Research Center" | "Kantin Pusat";

export type DisplayId = KnownDisplayId | Brand<string, "DisplayId">;
export type ZoneId = KnownZoneId | Brand<string, "ZoneId">;
export type BuildingId = KnownBuildingId | Brand<string, "BuildingId">;
export type AlertScopeId = "all" | DisplayId | ZoneId | BuildingId | Brand<string, "AlertScopeId">;
export type ContentId = Brand<string, "ContentId">;
export type CampaignId = Brand<string, "CampaignId">;
export type ClientId = Brand<string, "ClientId">;
export type MqttTopic = Brand<string, "MqttTopic">;

export type MqttQos = 0 | 1 | 2;
export type MqttUserProperties = Readonly<Record<string, string>>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export type DisplayRuntimeStatus = "online" | "offline" | "rendering" | "error" | "unknown";
export type AlertSeverity = "info" | "warn" | "warning" | "critical";
export type AlertType =
  | "fire"
  | "weather"
  | "security"
  | "hazmat"
  | "medical"
  | "power"
  | "custom";
export type AlertScope = "network" | "building" | "zone" | "display";
export type ContentMediaType = "image" | "video" | "html";
export type PeakPeriod = "peak" | "off_peak";

export interface DisplayHealthPayload {
  readonly status: DisplayRuntimeStatus;
  readonly screen_id: DisplayId;
  readonly temp: number;
  readonly cpu: number;
  readonly memory: number;
  readonly uptime: UnixSeconds;
  readonly current_content?: string;
}

export interface DisplayStatusPayload {
  readonly status: DisplayRuntimeStatus;
  readonly screen_id?: DisplayId;
  readonly reason?: string;
}

export interface ContentSchedulePayload {
  readonly content: string | null;
  readonly timestamp?: UnixSeconds;
  readonly status?: "active" | "removed";
  readonly media_url?: string;
  readonly media_type?: ContentMediaType;
  readonly filename?: string;
}

export interface ContentPlaylistItem {
  readonly id: CampaignId;
  readonly content: string;
  readonly type: ContentMediaType;
  readonly duration: number;
  readonly zone?: ZoneId;
  readonly display_id?: DisplayId;
}

export interface PlaylistRequestPayload {
  readonly screen_id: DisplayId;
}

export interface PlaylistResponsePayload {
  readonly playlist: readonly ContentPlaylistItem[];
  readonly timestamp: UnixSeconds;
}

export interface ActiveAlertPayload {
  readonly status?: "active";
  readonly message: string;
  readonly alert_type: AlertType;
  readonly severity: AlertSeverity;
  readonly timestamp?: UnixSeconds;
  readonly issuer?: ClientId;
  readonly expiry_time?: UnixSeconds;
}

export interface ClearedAlertPayload {
  readonly status: "cleared";
  readonly message?: "";
  readonly timestamp?: UnixSeconds;
}

export type AlertPayload = ActiveAlertPayload | ClearedAlertPayload;

export interface AnalyticsViewershipPayload {
  readonly screen_id: DisplayId;
  readonly zone_id: ZoneId;
  readonly viewer_count: number;
  readonly dwell_time: number;
  readonly peak_period: PeakPeriod;
  readonly timestamp: UnixSeconds;
}

export interface MaintenanceAlertPayload {
  readonly display_id: DisplayId;
  readonly reason: string;
  readonly timestamp: UnixSeconds;
}

export interface DisplayCommandPayload {
  readonly command: "restart";
}

export interface WeatherPayload {
  readonly temperature: number;
  readonly condition: string;
  readonly timestamp: UnixSeconds;
}

export type DisplayHealthTopic = `display/${DisplayId}/health`;
export type DisplayStatusTopic = `display/${DisplayId}/status`;
export type DisplayPlaylistRequestTopic = `display/${DisplayId}/request/playlist`;
export type DisplayPlaylistResponseTopic = `display/${DisplayId}/response/playlist`;
export type DisplayCommandTopic = `display/${DisplayId}/command`;
export type ContentZoneScheduleTopic = `content/zone/${ZoneId}/schedule`;
export type ContentDisplayOverrideTopic = `content/display/${DisplayId}/override`;
export type AlertTopic = `alert/${AlertScope}/${AlertScopeId}/emergency`;
export type AnalyticsViewershipTopic = `analytics/zone/${ZoneId}/viewership`;
export type MaintenanceAlertTopic = `maintenance/${DisplayId}/alert`;
export type WeatherTopic = `environment/${ZoneId}/weather`;

export type MqttSubscriptionPattern =
  | "display/+/health"
  | "display/+/status"
  | "alert/#"
  | "analytics/zone/+/viewership"
  | "content/zone/+/schedule"
  | "content/display/+/override"
  | "maintenance/+/alert";

export type DashboardConsumedTopic =
  | DisplayHealthTopic
  | DisplayStatusTopic
  | ContentZoneScheduleTopic
  | ContentDisplayOverrideTopic
  | AlertTopic
  | AnalyticsViewershipTopic
  | MaintenanceAlertTopic;

export type DashboardPublishedTopic =
  | ContentZoneScheduleTopic
  | ContentDisplayOverrideTopic
  | AlertTopic
  | MaintenanceAlertTopic
  | DisplayCommandTopic;

export type DashboardTopic = DashboardConsumedTopic | DashboardPublishedTopic;

export type PayloadForTopic<TTopic extends string> =
  TTopic extends DisplayHealthTopic ? DisplayHealthPayload :
  TTopic extends DisplayStatusTopic ? DisplayStatusPayload :
  TTopic extends DisplayPlaylistRequestTopic ? PlaylistRequestPayload :
  TTopic extends DisplayPlaylistResponseTopic ? PlaylistResponsePayload :
  TTopic extends ContentZoneScheduleTopic ? ContentSchedulePayload :
  TTopic extends ContentDisplayOverrideTopic ? ContentSchedulePayload :
  TTopic extends AlertTopic ? AlertPayload :
  TTopic extends AnalyticsViewershipTopic ? AnalyticsViewershipPayload :
  TTopic extends MaintenanceAlertTopic ? MaintenanceAlertPayload :
  TTopic extends DisplayCommandTopic ? DisplayCommandPayload :
  TTopic extends WeatherTopic ? WeatherPayload :
  JsonObject;

export interface MqttEnvelope<TTopic extends DashboardConsumedTopic = DashboardConsumedTopic> {
  readonly type: "mqtt_message";
  readonly topic: TTopic;
  readonly payload: PayloadForTopic<TTopic>;
  readonly qos: MqttQos;
  readonly retained: boolean;
  readonly user_properties: MqttUserProperties;
  readonly timestamp: ISO8601Timestamp;
}

export interface StateSnapshotMessage {
  readonly type: "state_snapshot";
  readonly messages: readonly MqttEnvelope[];
}

export type ServerToDashboardMessage = StateSnapshotMessage | MqttEnvelope;

export interface MqttPublishRequest<TTopic extends DashboardPublishedTopic = DashboardPublishedTopic> {
  readonly type: "mqtt_publish";
  readonly topic: TTopic;
  readonly payload: PayloadForTopic<TTopic>;
  readonly qos: MqttQos;
  readonly retain: boolean;
}

export type DashboardToServerMessage = MqttPublishRequest;
