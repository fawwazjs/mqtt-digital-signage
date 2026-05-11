"use strict";
// @ts-check

/**
 * @typedef {import("../types/state").DashboardState} DashboardState
 * @typedef {import("../types/state").NotificationSeverity} NotificationSeverity
 * @typedef {import("../types/state").NotificationType} NotificationType
 * @typedef {import("../types/state").PageId} PageId
 * @typedef {import("../types/protocol").AlertPayload} AlertPayload
 * @typedef {import("../types/protocol").AlertTopic} AlertTopic
 * @typedef {import("../types/protocol").AnalyticsViewershipPayload} AnalyticsViewershipPayload
 * @typedef {import("../types/protocol").ContentSchedulePayload} ContentSchedulePayload
 * @typedef {import("../types/protocol").DashboardPublishedTopic} DashboardPublishedTopic
 * @typedef {import("../types/protocol").DisplayHealthPayload} DisplayHealthPayload
 * @typedef {import("../types/protocol").DisplayId} DisplayId
 * @typedef {import("../types/protocol").DisplayStatusPayload} DisplayStatusPayload
 * @typedef {import("../types/protocol").ISO8601Timestamp} ISO8601Timestamp
 * @typedef {import("../types/protocol").MqttEnvelope} MqttEnvelope
 * @typedef {import("../types/protocol").MqttQos} MqttQos
 * @typedef {import("../types/protocol").PayloadForTopic<DashboardPublishedTopic>} PublishPayload
 * @typedef {import("../types/protocol").ServerToDashboardMessage} ServerToDashboardMessage
 * @typedef {import("../types/protocol").ZoneId} ZoneId
 */

// ── WebSocket config ───────────────────────────────────────────────────────
const WS_URL          = `ws://${location.hostname}:8765`;
const WS_MAX_RETRIES  = 10;
const WS_BACKOFF_BASE = 1000;   // ms
const WS_BACKOFF_MAX  = 30000;  // ms

// ── State ──────────────────────────────────────────────────────────────────
/** @type {DashboardState} */
const state = {
  displays:         {},  // id → merged health + status + config
  alerts:           {},  // topic → alert envelope
  analytics:        {},  // zone_id → latest viewership
  contentSchedules: {},  // topic → schedule payload
  auditLog:         [],  // capped at 2000 entries
  notifications:    [],  // capped at 500 entries
  unreadCritical:   0,
  activePage:       null,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $app           = _mustGet("app");
const $connStatus    = _mustGet("conn-status");
const $connLabel     = _mustGet("conn-label");
const $clock         = _mustGet("topbar-clock");
const $navItems      = _mustGet("nav-items");
const $sidebarToggle = _mustGet("sidebar-toggle");
const $ribbon        = _mustGet("alert-ribbon");
const $ribbonScope   = _mustGet("ribbon-scope");
const $ribbonMsg     = _mustGet("ribbon-message");
const $ribbonCount   = _mustGet("ribbon-count");
const $ribbonDismiss = _mustGet("ribbon-dismiss");

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function _mustGet(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM node: ${id}`);
  return el;
}

// ── Clock ──────────────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  /** @param {number} n */
  const pad = n => String(n).padStart(2, "0");
  $clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// ── Sidebar ────────────────────────────────────────────────────────────────
let _sidebarExpanded = false;

/** @param {boolean} right */
function _chevron(right) {
  return right
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><polyline points="5 3 9 7 5 11"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><polyline points="9 3 5 7 9 11"/></svg>`;
}

$sidebarToggle.innerHTML = _chevron(true);
$sidebarToggle.addEventListener("click", () => {
  _sidebarExpanded = !_sidebarExpanded;
  $app.classList.toggle("sidebar-expanded", _sidebarExpanded);
  $sidebarToggle.innerHTML = _chevron(!_sidebarExpanded);
});

// ── Navigation ─────────────────────────────────────────────────────────────
$navItems.setAttribute("role", "navigation");
$navItems.setAttribute("aria-label", "Main navigation");

PAGES.forEach(page => {
  const btn = document.createElement("button");
  btn.className = "nav-item";
  btn.dataset.page = page.id;
  btn.setAttribute("aria-label", page.label);
  btn.setAttribute("aria-current", "false");
  btn.innerHTML =
    page.icon +
    `<span class="nav-label" aria-hidden="true">${page.label}</span>` +
    (page.badge ? `<span class="nav-badge" id="badge-${page.id}" aria-live="polite"></span>` : "");
  btn.addEventListener("click", () => navigateTo(page.id));
  $navItems.appendChild(btn);
});

/** @param {PageId} pageId */
function navigateTo(pageId) {
  if (state.activePage === pageId) return;

  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.remove("active");
    b.setAttribute("aria-current", "false");
  });
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));

  const btn  = document.querySelector(`[data-page="${pageId}"]`);
  const page = document.getElementById(`page-${pageId}`);
  if (!btn || !page) return;

  btn.classList.add("active");
  btn.setAttribute("aria-current", "page");
  page.classList.add("active");
  state.activePage = pageId;

  if (location.hash !== `#${pageId}`) {
    history.replaceState(null, "", `#${pageId}`);
  }

  // Lifecycle hook — page module exposes window.mount_{pageId}(el)
  const mount = _pageHook("mount", pageId);
  if (mount) {
    mount(page);
  }
}

function initRouting() {
  const hash  = location.hash.replace("#", "");
  const valid = PAGES.find(p => p.id === hash);
  navigateTo(valid ? valid.id : "map");
}

// ── Connection status ──────────────────────────────────────────────────────
/**
 * @param {string} cls
 * @param {string} label
 */
function setConnStatus(cls, label) {
  $connStatus.className = cls;
  $connLabel.textContent = label;
}

// ── WebSocket client ───────────────────────────────────────────────────────
/** @type {WebSocket | null} */
let _ws        = null;
let _wsRetries = 0;

function connectWS() {
  setConnStatus("connecting", "Connecting...");
  _ws = new WebSocket(WS_URL);
  state.ws = _ws;

  _ws.onopen = () => {
    _wsRetries = 0;
    setConnStatus("connected", "Connected");
  };

  _ws.onmessage = e => {
    try { handleMsg(/** @type {ServerToDashboardMessage} */ (JSON.parse(e.data))); } catch {}
  };

  _ws.onerror = () => {};

  _ws.onclose = () => {
    if (_wsRetries >= WS_MAX_RETRIES) {
      setConnStatus("disconnected", "Disconnected");
      return;
    }
    const delay = Math.min(WS_BACKOFF_BASE * Math.pow(2, _wsRetries), WS_BACKOFF_MAX);
    _wsRetries++;
    setConnStatus("reconnecting", "Reconnecting...");
    setTimeout(connectWS, delay);
  };
}

// ── Message routing ────────────────────────────────────────────────────────
/** @param {ServerToDashboardMessage} msg */
function handleMsg(msg) {
  if (msg.type === "state_snapshot") {
    msg.messages.forEach(processMsg);
    return;
  }
  if (msg.type === "mqtt_message") {
    processMsg(msg);
  }
}

/** @param {MqttEnvelope} msg */
function processMsg(msg) {
  const { topic, payload, qos, retained, user_properties, timestamp } = msg;
  const parts = topic.split("/");

  // Audit — every message
  state.auditLog.unshift({ topic, payload, qos, retained, user_properties, timestamp });
  if (state.auditLog.length > 2000) state.auditLog.length = 2000;

  if (parts[0] === "display" && parts[2] === "health") {
    _onDisplayHealth(/** @type {DisplayId} */ (parts[1]), /** @type {DisplayHealthPayload} */ (payload), timestamp);

  } else if (parts[0] === "display" && parts[2] === "status") {
    _onDisplayStatus(/** @type {DisplayId} */ (parts[1]), /** @type {DisplayStatusPayload} */ (payload), timestamp);

  } else if (parts[0] === "alert") {
    _onAlert(/** @type {AlertTopic} */ (topic), /** @type {AlertPayload} */ (payload), timestamp);

  } else if (parts[0] === "analytics" && parts[1] === "zone") {
    state.analytics[/** @type {ZoneId} */ (parts[2])] = { .../** @type {AnalyticsViewershipPayload} */ (payload), timestamp };

  } else if (parts[0] === "content") {
    const contentTopic = /** @type {import("../types/protocol").ContentZoneScheduleTopic | import("../types/protocol").ContentDisplayOverrideTopic} */ (topic);
    state.contentSchedules[contentTopic] = { .../** @type {ContentSchedulePayload} */ (payload), topic: contentTopic, user_properties, timestamp };
    _propagateContent(parts, /** @type {ContentSchedulePayload} */ (payload));

  } else if (parts[0] === "maintenance") {
    _pushNotification({ type: "maintenance_alert", ref: /** @type {DisplayId} */ (parts[1]), timestamp, severity: "warn" });
  }

  // Forward to active page
  const onMsg = state.activePage ? _pageHook("onMsg", state.activePage) : null;
  if (onMsg) {
    onMsg(msg);
  }
}

/**
 * @param {DisplayId} id
 * @param {DisplayHealthPayload} payload
 * @param {ISO8601Timestamp} timestamp
 */
function _onDisplayHealth(id, payload, timestamp) {
  const cfg = DISPLAYS.find(d => d.id === id) || {};
  state.displays[id] = {
    ...cfg,
    ...(state.displays[id] || {}),
    ...payload,
    id,
    lastHealthAt: timestamp,
  };
}

/**
 * @param {DisplayId} id
 * @param {DisplayStatusPayload} payload
 * @param {ISO8601Timestamp} timestamp
 */
function _onDisplayStatus(id, payload, timestamp) {
  const cfg = DISPLAYS.find(d => d.id === id) || {};
  state.displays[id] = {
    ...cfg,
    ...(state.displays[id] || {}),
    ...payload,
    id,
    lastStatusAt: timestamp,
  };
  if (payload.status === "offline") {
    _pushNotification({ type: "display_offline", ref: id, timestamp, severity: "critical" });
  } else if (payload.status === "online") {
    _pushNotification({ type: "display_online", ref: id, timestamp, severity: "info" });
  }
}

/**
 * @param {AlertTopic} topic
 * @param {AlertPayload} payload
 * @param {ISO8601Timestamp} timestamp
 */
function _onAlert(topic, payload, timestamp) {
  if (payload.status === "cleared") {
    delete state.alerts[topic];
    _pushNotification({ type: "alert_cleared", ref: topic, timestamp, severity: "info" });
  } else {
    state.alerts[topic] = { ...payload, topic, timestamp };
    _pushNotification({ type: "alert_issued", ref: topic, timestamp, severity: "critical" });
  }
  _refreshRibbon();
}

/**
 * @param {string[]} parts
 * @param {ContentSchedulePayload} payload
 */
function _propagateContent(parts, payload) {
  if (parts[1] === "zone") {
    const zone = parts[2];
    DISPLAYS.filter(d => d.zone === zone).forEach(d => {
      const display = state.displays[d.id];
      if (display) {
        display.currentContent = payload.content;
      }
    });
  } else if (parts[1] === "display") {
    const id = /** @type {DisplayId} */ (parts[2]);
    const display = state.displays[id];
    if (display) display.currentContent = payload.content;
  }
}

// ── Alert Ribbon ───────────────────────────────────────────────────────────
/** @type {string | null} */
let _ribbonDismissedAt = null;

function _refreshRibbon() {
  /** @type {import("../types/state").AlertState[]} */
  const alerts = Object.values(state.alerts).filter(a => a != null);

  // Filter to alerts newer than last dismiss
  const dismissedAt = _ribbonDismissedAt;
  const active = dismissedAt
    ? alerts.filter(a => a.timestamp > dismissedAt)
    : alerts;

  if (active.length === 0) {
    $ribbon.classList.remove("show");
    return;
  }

  // Sort by timestamp desc, show latest
  active.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const latest = active[0];
  if (!latest) {
    $ribbon.classList.remove("show");
    return;
  }

  // Parse scope from topic: alert/{scope}/{scope_id}/emergency
  const parts = latest.topic.split("/");
  const scope = parts[1] || "network";
  const scopeId = parts[2] || "";
  const scopeLabel = scope === "network" ? "NETWORK" : `${scope.toUpperCase()}: ${scopeId}`;

  $ribbonScope.textContent = scopeLabel;
  $ribbonMsg.textContent = latest.message || "Emergency alert active";
  $ribbonCount.textContent = active.length > 1 ? `+${active.length - 1}` : "";
  $ribbon.classList.add("show");
}

$ribbonDismiss.addEventListener("click", () => {
  _ribbonDismissedAt = new Date().toISOString();
  $ribbon.classList.remove("show");
});

// ── Notifications ──────────────────────────────────────────────────────────
/**
 * @param {{type: NotificationType, ref: DisplayId | AlertTopic, timestamp: ISO8601Timestamp, severity: NotificationSeverity}} draft
 */
function _pushNotification(draft) {
  const n = {
    ...draft,
    id:   /** @type {import("../types/state").NotificationId} */ (`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    read: false,
  };
  state.notifications.unshift(n);
  if (state.notifications.length > 500) state.notifications.length = 500;

  const critical = state.notifications.filter(x => !x.read && x.severity === "critical").length;
  const warn     = state.notifications.filter(x => !x.read && x.severity === "warn").length;
  state.unreadCritical = critical;
  _updateBadge(critical + warn, critical > 0 ? "critical" : "warn");
}

/**
 * @param {number} count
 * @param {NotificationSeverity} severity
 */
function _updateBadge(count, severity) {
  const el = document.getElementById("badge-notifications");
  if (!el) return;
  el.textContent = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  el.className   = "nav-badge" + (count > 0 ? " show" : "") + (severity === "critical" ? "" : " warn");
}

// ── Publish helper ─────────────────────────────────────────────────────────
/**
 * @param {DashboardPublishedTopic} topic
 * @param {PublishPayload} payload
 * @param {MqttQos} [qos]
 * @param {boolean} [retain]
 */
function mqttPublish(topic, payload, qos = 1, retain = false) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  _ws.send(JSON.stringify({ type: "mqtt_publish", topic, payload, qos, retain }));
}

/**
 * @param {"mount" | "onMsg"} kind
 * @param {PageId} pageId
 * @returns {((arg: HTMLElement | MqttEnvelope) => void) | null}
 */
function _pageHook(kind, pageId) {
  // Normalize hyphenated page IDs to underscore (content-mgmt → content_mgmt)
  const normalized = pageId.replace(/-/g, "_");
  const key = `${kind}_${normalized}`;
  const hook = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window))[key];
  return typeof hook === "function" ? /** @type {(arg: HTMLElement | MqttEnvelope) => void} */ (hook) : null;
}

// ── Utilities ──────────────────────────────────────────────────────────────
/**
 * Debounce function calls. Returns a wrapper that delays execution until
 * no calls have been made for `wait` milliseconds.
 * @template {(...args: unknown[]) => void} T
 * @param {T} fn
 * @param {number} wait
 * @returns {T}
 */
function debounce(fn, wait) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeout = null;
  /** @param {unknown[]} args */
  const debounced = (...args) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
  return /** @type {T} */ (/** @type {unknown} */ (debounced));
}

// ── Init ───────────────────────────────────────────────────────────────────
function _boot() {
  connectWS();
  initRouting();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _boot, { once: true });
} else {
  _boot();
}
