import type {
  AlertTypeConfig,
  DashboardState,
  DisplayConfig,
  NotificationSeverity,
  PageConfig,
  PageId,
  ZoneConfig,
} from "./state";
import type { DashboardWindow, MqttPublish } from "./state";
import type { AlertTopic, DisplayId, ISO8601Timestamp, ZoneId } from "./protocol";

type MapStatus = "online" | "offline" | "loading" | "degraded" | "emergency";

declare global {
  const DISPLAYS: readonly DisplayConfig[];
  const ZONES: Readonly<Partial<Record<ZoneId, ZoneConfig>>>;
  const PAGES: readonly PageConfig[];
  const ALERT_TYPES: readonly AlertTypeConfig[];
  const state: DashboardState;

  function debounce<T extends (...args: unknown[]) => void>(fn: T, wait: number): T;

  function navigateTo(pageId: PageId): void;
  const mqttPublish: MqttPublish;

  function _getStatus(id: DisplayId): MapStatus;
  function _alertAffects(topic: AlertTopic | string, cfg: DisplayConfig | undefined): boolean;
  function _timeAgo(ts: ISO8601Timestamp | undefined): string;
  function _fmtTs(ts: ISO8601Timestamp | undefined): string;
  function _esc(s: unknown): string;
  function _renderPanel(id: DisplayId): string;
  function _updateBadge(count: number, severity: NotificationSeverity): void;

  interface Window extends DashboardWindow {}
}

export {};
