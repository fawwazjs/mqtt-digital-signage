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
  displayViewers:   {},  // display_id → latest viewership
  contentSchedules: {},  // topic → schedule payload
  auditLog:         [],  // capped at 2000 entries
  notifications:    [],  // capped at 500 entries
  unreadCritical:   0,
  activePage:       null,
};

const settings = {
  theme: localStorage.getItem("ds-theme") || "dark",
  reducedMotion: localStorage.getItem("ds-reduced-motion") || "system",
  highContrast: localStorage.getItem("ds-high-contrast") === "true",
  largeText: localStorage.getItem("ds-large-text") === "true",
  sound: localStorage.getItem("ds-sound") === "true",
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $app           = _mustGet("app");
const $connStatus    = _mustGet("conn-status");
const $connLabel     = _mustGet("conn-label");
const $clock         = _mustGet("topbar-clock");
const $kpiTotal      = _mustGet("kpi-total");
const $kpiOnline     = _mustGet("kpi-online");
const $kpiOffline    = _mustGet("kpi-offline");
const $kpiAlerts     = _mustGet("kpi-alerts");
const $navItems      = _mustGet("nav-items");
const $sidebarToggle = _mustGet("sidebar-toggle");
const $notifBell     = _mustGet("notif-bell");
const $notifBellBadge = _mustGet("notif-bell-badge");
const $notifPopover  = _mustGet("notif-popover");
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
let _sidebarExpanded = window.matchMedia("(min-width: 1440px)").matches;

/** @param {boolean} right */
function _chevron(right) {
  return right
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><polyline points="5 3 9 7 5 11"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><polyline points="9 3 5 7 9 11"/></svg>`;
}

$app.classList.toggle("sidebar-expanded", _sidebarExpanded);
$sidebarToggle.innerHTML = _chevron(!_sidebarExpanded);
$sidebarToggle.addEventListener("click", () => {
  _sidebarExpanded = !_sidebarExpanded;
  $app.classList.toggle("sidebar-expanded", _sidebarExpanded);
  $sidebarToggle.innerHTML = _chevron(!_sidebarExpanded);
});

// ── Navigation ─────────────────────────────────────────────────────────────
$navItems.setAttribute("role", "navigation");
$navItems.setAttribute("aria-label", "Main navigation");

PAGES.filter(page => !page.hideFromNav).forEach(page => {
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

const settingsBtn = document.createElement("button");
settingsBtn.id = "settings-open";
settingsBtn.className = "nav-item settings-nav";
settingsBtn.setAttribute("aria-label", "Settings");
settingsBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="10" cy="10" r="2.5"/><path d="M16 10a6 6 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L11.5 1h-4l-.3 3a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L3.1 9a6 6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 3h4l.3-3a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></svg>
  <span class="nav-label" aria-hidden="true">Settings</span>`;
settingsBtn.addEventListener("click", openSettingsPanel);
$navItems.appendChild(settingsBtn);

/** @param {PageId} pageId */
function navigateTo(pageId) {
  if (state.activePage === pageId) {
    _mountPage(pageId);
    return;
  }

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

  _mountPage(pageId);
}

function initRouting() {
  const hash  = location.hash.replace("#", "");
  const valid = PAGES.find(p => p.id === hash);
  navigateTo(valid ? valid.id : "map");
}

/** @param {PageId} pageId */
function _mountPage(pageId) {
  const page = document.getElementById(`page-${pageId}`);
  if (!page) return;

  const mount = _pageHook("mount", pageId);
  if (!mount) {
    page.dataset.mountPending = "true";
    return;
  }
  delete page.dataset.mountPending;
  mount(page);
}

window.addEventListener("hashchange", initRouting);
window.addEventListener("load", () => {
  if (state.activePage) _mountPage(state.activePage);
});

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
    const analytics = { .../** @type {AnalyticsViewershipPayload} */ (payload), timestamp };
    state.analytics[/** @type {ZoneId} */ (parts[2])] = analytics;
    state.displayViewers[analytics.screen_id] = analytics;

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
  _refreshFleetKpis();
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
        display.mediaUrl = payload.media_url;
        display.mediaType = payload.media_type;
      }
    });
  } else if (parts[1] === "display") {
    const id = /** @type {DisplayId} */ (parts[2]);
    const display = state.displays[id];
    if (display) {
      display.currentContent = payload.content;
      display.mediaUrl = payload.media_url;
      display.mediaType = payload.media_type;
    }
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

  _syncNotificationBadges();
  _renderNotificationPopover();
}

/**
 * @param {number} count
 * @param {NotificationSeverity} severity
 */
function _updateBadge(count, severity) {
  const el = document.getElementById("badge-notifications");
  const label = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  const sevCls = severity === "critical" ? "critical" : "warn";
  if (el) {
    el.textContent = label;
    el.className   = "nav-badge" + (count > 0 ? " show" : "") + (severity === "critical" ? "" : " warn");
  }
  $notifBellBadge.textContent = label;
  $notifBellBadge.className = count > 0 ? `show ${sevCls}` : "";
}

function _syncNotificationBadges() {
  const unread   = state.notifications.filter(x => !x.read && (x.severity === "critical" || x.severity === "warn"));
  const critical = unread.filter(x => x.severity === "critical").length;
  const warn     = unread.filter(x => x.severity === "warn").length;
  const total    = critical + warn;
  const severity = critical > 0 ? "critical" : "warn";

  state.unreadCritical = critical;
  _updateBadge(total, severity);
}

function _refreshFleetKpis() {
  const total = DISPLAYS.length;
  let online = 0;
  let offline = 0;
  DISPLAYS.forEach(d => {
    const st = state.displays[d.id]?.status;
    if (st === "offline") offline++;
    else if (state.displays[d.id]?.lastHealthAt) online++;
  });
  $kpiTotal.textContent = String(total);
  $kpiOnline.textContent = String(online);
  $kpiOffline.textContent = String(offline);
  $kpiAlerts.textContent = String(Object.keys(state.alerts).length);
}

function _applySettings() {
  document.body.dataset.theme = settings.theme;
  document.body.classList.toggle("high-contrast", settings.highContrast);
  document.body.classList.toggle("large-text", settings.largeText);
  document.body.classList.toggle("reduce-motion", settings.reducedMotion === "on");
}

function openSettingsPanel() {
  let panel = document.getElementById("settings-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "settings-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Dashboard settings");
    document.body.appendChild(panel);
  }
  panel.innerHTML = `
    <div class="settings-backdrop" data-close-settings></div>
    <section class="settings-sheet">
      <div class="settings-head">
        <div><span>Settings</span><small>Preferences persist locally</small></div>
        <button class="settings-close" data-close-settings aria-label="Close settings">×</button>
      </div>
      <div class="settings-grid">
        ${_settingSelect("Theme", "theme", settings.theme, [["dark","Dark"],["light","Light"]])}
        ${_settingSelect("Motion", "reducedMotion", settings.reducedMotion, [["system","System"],["off","Full"],["on","Reduced"]])}
        ${_settingToggle("High contrast", "highContrast", settings.highContrast)}
        ${_settingToggle("Large text", "largeText", settings.largeText)}
        ${_settingToggle("Notification sound", "sound", settings.sound)}
      </div>
    </section>`;
  panel.classList.add("open");
  panel.querySelectorAll("[data-close-settings]").forEach(el => el.addEventListener("click", closeSettingsPanel));
  panel.querySelectorAll("[data-setting]").forEach(el => {
    el.addEventListener("change", () => {
      const input = /** @type {HTMLInputElement | HTMLSelectElement} */ (el);
      const key = input.dataset.setting || "";
      if (key === "theme" || key === "reducedMotion") settings[key] = input.value;
      if (key === "highContrast" || key === "largeText" || key === "sound") settings[key] = /** @type {HTMLInputElement} */ (input).checked;
      _persistSettings();
      _applySettings();
    });
  });
  const close = panel.querySelector(".settings-close");
  if (close instanceof HTMLElement) close.focus();
}

function closeSettingsPanel() {
  document.getElementById("settings-panel")?.classList.remove("open");
}

/**
 * @param {string} label
 * @param {string} key
 * @param {string} value
 * @param {string[][]} opts
 */
function _settingSelect(label, key, value, opts) {
  return `<label class="setting-row"><span>${_esc(label)}</span><select data-setting="${_esc(key)}">${opts.map(([v,l]) => `<option value="${_esc(v)}" ${value === v ? "selected" : ""}>${_esc(l)}</option>`).join("")}</select></label>`;
}

/** @param {string} label @param {string} key @param {boolean} checked */
function _settingToggle(label, key, checked) {
  return `<label class="setting-row"><span>${_esc(label)}</span><input type="checkbox" data-setting="${_esc(key)}" ${checked ? "checked" : ""}></label>`;
}

function _persistSettings() {
  localStorage.setItem("ds-theme", settings.theme);
  localStorage.setItem("ds-reduced-motion", settings.reducedMotion);
  localStorage.setItem("ds-high-contrast", String(settings.highContrast));
  localStorage.setItem("ds-large-text", String(settings.largeText));
  localStorage.setItem("ds-sound", String(settings.sound));
}

function _toggleNotificationPopover() {
  const open = !$notifPopover.classList.contains("open");
  $notifPopover.classList.toggle("open", open);
  $notifBell.setAttribute("aria-expanded", String(open));
  if (open) _renderNotificationPopover();
}

function _closeNotificationPopover() {
  $notifPopover.classList.remove("open");
  $notifBell.setAttribute("aria-expanded", "false");
}

function _renderNotificationPopover() {
  if (!$notifPopover.classList.contains("open") && state.notifications.length === 0) {
    $notifPopover.innerHTML = "";
    return;
  }

  const recent = state.notifications.slice(0, 10);
  if (!recent.length) {
    $notifPopover.innerHTML = `<div class="np-empty">No notifications.</div>`;
    return;
  }

  $notifPopover.innerHTML = `
    <div class="np-head">
      <span>Recent Notifications</span>
      <button id="np-mark-read" class="np-link">Mark read</button>
    </div>
    <div class="np-list">
      ${recent.map(n => {
        const meta = _notificationMeta(n);
        return `<button class="np-item sev-${_esc(n.severity)} ${n.read ? "" : "unread"}" data-id="${_esc(n.id)}">
          <span class="np-sev">${_esc(n.severity)}</span>
          <span class="np-body">
            <span class="np-title">${_esc(meta.title)}</span>
            <span class="np-desc">${_esc(meta.desc)}</span>
          </span>
          <span class="np-ts" title="${_esc(n.timestamp)}">${_timeAgo(n.timestamp)}</span>
        </button>`;
      }).join("")}
    </div>
    <button id="np-view-all" class="np-view-all">View All</button>`;

  $notifPopover.querySelector("#np-mark-read")?.addEventListener("click", e => {
    e.stopPropagation();
    state.notifications.forEach(n => { n.read = true; });
    _syncNotificationBadges();
    _renderNotificationPopover();
  });

  $notifPopover.querySelectorAll(".np-item").forEach(row => {
    row.addEventListener("click", () => {
      const id = /** @type {import("../types/state").NotificationId | undefined} */ (/** @type {HTMLElement} */ (row).dataset.id);
      const n = state.notifications.find(x => x.id === id);
      if (n) {
        n.read = true;
        _syncNotificationBadges();
        _navigateFromNotification(n);
      }
      _closeNotificationPopover();
    });
  });

  $notifPopover.querySelector("#np-view-all")?.addEventListener("click", () => {
    _closeNotificationPopover();
    navigateTo("notifications");
  });
}

/** @param {import("../types/state").DashboardNotification} n */
function _notificationMeta(n) {
  switch (n.type) {
    case "display_offline":
      return { title: `Display ${n.ref} offline`, desc: "LWT offline status received." };
    case "display_online":
      return { title: `Display ${n.ref} online`, desc: "Display status recovered." };
    case "maintenance_alert":
      return { title: `Maintenance: ${n.ref}`, desc: "Operator or monitor flagged display." };
    case "alert_issued":
      return { title: "Emergency alert issued", desc: String(n.ref) };
    case "alert_cleared":
      return { title: "Emergency alert cleared", desc: String(n.ref) };
    default:
      return { title: n.type, desc: String(n.ref) };
  }
}

/** @param {import("../types/state").DashboardNotification} n */
function _navigateFromNotification(n) {
  if (n.type === "display_offline" || n.type === "display_online" || n.type === "maintenance_alert") {
    Object.assign(window, { _pendingMapDisplay: /** @type {DisplayId} */ (n.ref) });
    navigateTo("map");
    return;
  }
  navigateTo("notifications");
}

$notifBell.addEventListener("click", e => {
  e.stopPropagation();
  _toggleNotificationPopover();
});

document.addEventListener("click", e => {
  const target = /** @type {Node | null} */ (e.target);
  if (target && !$notifPopover.contains(target) && !$notifBell.contains(target)) {
    _closeNotificationPopover();
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") _closeNotificationPopover();
  if (e.key === "Escape") closeSettingsPanel();
  if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
    e.preventDefault();
    $notifBell.focus();
    _toggleNotificationPopover();
  }
});

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

/** @param {unknown} s */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {ISO8601Timestamp | undefined} ts */
function _timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** @param {ISO8601Timestamp | undefined} ts */
function _fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
function _boot() {
  _applySettings();
  connectWS();
  initRouting();
  _syncNotificationBadges();
  _refreshFleetKpis();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _boot, { once: true });
} else {
  _boot();
}
