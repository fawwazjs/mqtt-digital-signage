import type {
  AlertPayload,
  AlertSeverity,
  AlertType,
  AlertTopic,
  AnalyticsViewershipPayload,
  BuildingId,
  Brand,
  ContentDisplayOverrideTopic,
  ContentSchedulePayload,
  ContentZoneScheduleTopic,
  DashboardConsumedTopic,
  DashboardPublishedTopic,
  DashboardTopic,
  DisplayHealthPayload,
  DisplayId,
  DisplayRuntimeStatus,
  DisplayStatusPayload,
  ISO8601Timestamp,
  JsonValue,
  MqttEnvelope,
  MqttQos,
  MqttSubscriptionPattern,
  MqttTopic,
  MqttUserProperties,
  PayloadForTopic,
  ZoneId,
} from "./protocol";

export type PageId = "map" | "grid" | "content-mgmt" | "analytics" | "notifications" | "audit";
export type NotificationSeverity = Extract<AlertSeverity, "critical" | "warn" | "info">;
export type NotificationType =
  | "display_offline"
  | "display_online"
  | "maintenance_alert"
  | "alert_issued"
  | "alert_cleared";
export type NotificationId = Brand<string, "NotificationId">;
export type NotificationRef = DisplayId | AlertTopic;

export interface DisplayConfig {
  readonly id: DisplayId;
  readonly name: string;
  readonly zone: ZoneId;
  readonly building: BuildingId;
  readonly floor: number;
  readonly lat: number;
  readonly lng: number;
  readonly scopeMeters?: number;
}

export interface ZoneConfig {
  readonly building: BuildingId;
  readonly label: string;
}

export interface PageConfig {
  readonly id: PageId;
  readonly label: string;
  readonly topics: readonly MqttSubscriptionPattern[];
  readonly icon: string;
  readonly badge?: boolean;
  readonly hideFromNav?: boolean;
}

export interface AlertTypeConfig {
  readonly id: AlertType;
  readonly label: string;
  readonly defaultMsg: string;
}

export interface DisplayState extends Partial<DisplayConfig>, Partial<DisplayHealthPayload>, Partial<DisplayStatusPayload> {
  readonly id: DisplayId;
  status?: DisplayRuntimeStatus;
  currentContent?: string | null;
  lastHealthAt?: ISO8601Timestamp;
  lastStatusAt?: ISO8601Timestamp;
}

export type AlertState = Omit<AlertPayload, "timestamp"> & {
  readonly topic: AlertTopic;
  readonly timestamp: ISO8601Timestamp;
};

export interface AnalyticsState extends Omit<AnalyticsViewershipPayload, "timestamp"> {
  readonly timestamp: ISO8601Timestamp;
}

export interface ContentScheduleState extends Omit<ContentSchedulePayload, "timestamp"> {
  readonly topic: ContentZoneScheduleTopic | ContentDisplayOverrideTopic;
  readonly user_properties: MqttUserProperties;
  readonly timestamp: ISO8601Timestamp;
}

export interface AuditLogEntry {
  readonly topic: DashboardTopic | MqttTopic;
  readonly payload: PayloadForTopic<DashboardConsumedTopic> | JsonValue;
  readonly qos: MqttQos;
  readonly retained: boolean;
  readonly user_properties: MqttUserProperties;
  readonly timestamp: ISO8601Timestamp;
}

export interface DashboardNotification {
  readonly id: NotificationId;
  readonly type: NotificationType;
  readonly ref: NotificationRef;
  readonly timestamp: ISO8601Timestamp;
  readonly severity: NotificationSeverity;
  read: boolean;
}

export interface DashboardState {
  readonly displays: Partial<Record<DisplayId, DisplayState>>;
  readonly alerts: Partial<Record<AlertTopic, AlertState>>;
  readonly analytics: Partial<Record<ZoneId, AnalyticsState>>;
  readonly displayViewers: Partial<Record<DisplayId, AnalyticsState>>;
  readonly contentSchedules: Partial<Record<ContentZoneScheduleTopic | ContentDisplayOverrideTopic, ContentScheduleState>>;
  readonly auditLog: AuditLogEntry[];
  readonly notifications: DashboardNotification[];
  unreadCritical: number;
  activePage: PageId | null;
  ws?: WebSocket;
}

export type PageMountHandler = (root: HTMLElement) => void;
export type PageMessageHandler<TMessage extends MqttEnvelope = MqttEnvelope> = (message: TMessage) => void;

export type MqttPublish = <TTopic extends DashboardPublishedTopic>(
  topic: TTopic,
  payload: PayloadForTopic<TTopic>,
  qos?: MqttQos,
  retain?: boolean,
) => void;

export interface DashboardWindow {
  mount_map?: PageMountHandler;
  mount_grid?: PageMountHandler;
  mount_content_mgmt?: PageMountHandler;
  mount_notifications?: PageMountHandler;
  mount_analytics?: PageMountHandler;
  mount_audit?: PageMountHandler;
  onMsg_map?: PageMessageHandler;
  onMsg_grid?: PageMessageHandler;
  onMsg_content_mgmt?: PageMessageHandler;
  onMsg_notifications?: PageMessageHandler;
  onMsg_analytics?: PageMessageHandler;
  onMsg_audit?: PageMessageHandler;
  _auditPendingDisplay?: DisplayId | null;
  _pendingMapDisplay?: DisplayId | null;
}
