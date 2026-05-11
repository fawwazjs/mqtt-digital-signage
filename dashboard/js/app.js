"use strict";

// ── WebSocket config ───────────────────────────────────────────────────────
const WS_URL          = `ws://${location.hostname}:8765`;
const WS_MAX_RETRIES  = 10;
const WS_BACKOFF_BASE = 1000;   // ms
const WS_BACKOFF_MAX  = 30000;  // ms

// ── State ──────────────────────────────────────────────────────────────────
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
const $app           = document.getElementById("app");
const $connStatus    = document.getElementById("conn-status");
const $connLabel     = document.getElementById("conn-label");
const $connDot       = document.getElementById("conn-dot");
const $clock         = document.getElementById("topbar-clock");
const $navItems      = document.getElementById("nav-items");
const $sidebarToggle = document.getElementById("sidebar-toggle");

// ── Clock ──────────────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  $clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// ── Sidebar ────────────────────────────────────────────────────────────────
let _sidebarExpanded = false;

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
PAGES.forEach(page => {
  const btn = document.createElement("button");
  btn.className = "nav-item";
  btn.dataset.page = page.id;
  btn.setAttribute("aria-label", page.label);
  btn.innerHTML =
    page.icon +
    `<span class="nav-label">${page.label}</span>` +
    (page.badge ? `<span class="nav-badge" id="badge-${page.id}"></span>` : "");
  btn.addEventListener("click", () => navigateTo(page.id));
  $navItems.appendChild(btn);
});

function navigateTo(pageId) {
  if (state.activePage === pageId) return;

  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));

  const btn  = document.querySelector(`[data-page="${pageId}"]`);
  const page = document.getElementById(`page-${pageId}`);
  if (!btn || !page) return;

  btn.classList.add("active");
  page.classList.add("active");
  state.activePage = pageId;

  if (location.hash !== `#${pageId}`) {
    history.replaceState(null, "", `#${pageId}`);
  }

  // Lifecycle hook — page module exposes window.mount_{pageId}(el)
  if (typeof window[`mount_${pageId}`] === "function") {
    window[`mount_${pageId}`](page);
  }
}

function initRouting() {
  const hash  = location.hash.replace("#", "");
  const valid = PAGES.find(p => p.id === hash);
  navigateTo(valid ? hash : "map");
}

// ── Connection status ──────────────────────────────────────────────────────
function setConnStatus(cls, label) {
  $connStatus.className = cls;
  $connLabel.textContent = label;
}

// ── WebSocket client ───────────────────────────────────────────────────────
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
    try { handleMsg(JSON.parse(e.data)); } catch (_) {}
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
function handleMsg(msg) {
  if (msg.type === "state_snapshot") {
    msg.messages.forEach(processMsg);
    return;
  }
  if (msg.type === "mqtt_message") {
    processMsg(msg);
  }
}

function processMsg(msg) {
  const { topic, payload, qos, retained, user_properties, timestamp } = msg;
  const parts = topic.split("/");

  // Audit — every message
  state.auditLog.unshift({ topic, payload, qos, retained, user_properties, timestamp });
  if (state.auditLog.length > 2000) state.auditLog.length = 2000;

  if (parts[0] === "display" && parts[2] === "health") {
    _onDisplayHealth(parts[1], payload, timestamp);

  } else if (parts[0] === "display" && parts[2] === "status") {
    _onDisplayStatus(parts[1], payload, timestamp);

  } else if (parts[0] === "alert") {
    _onAlert(topic, payload, timestamp);

  } else if (parts[0] === "analytics" && parts[1] === "zone") {
    state.analytics[parts[2]] = { ...payload, timestamp };

  } else if (parts[0] === "content") {
    state.contentSchedules[topic] = { ...payload, topic, user_properties, timestamp };
    _propagateContent(parts, payload);

  } else if (parts[0] === "maintenance") {
    _pushNotification({ type: "maintenance_alert", ref: parts[1], timestamp, severity: "warn" });
  }

  // Forward to active page
  if (state.activePage && typeof window[`onMsg_${state.activePage}`] === "function") {
    window[`onMsg_${state.activePage}`](msg);
  }
}

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

function _onAlert(topic, payload, timestamp) {
  if (payload.status === "cleared") {
    delete state.alerts[topic];
    _pushNotification({ type: "alert_cleared", ref: topic, timestamp, severity: "info" });
  } else {
    state.alerts[topic] = { ...payload, topic, timestamp };
    _pushNotification({ type: "alert_issued", ref: topic, timestamp, severity: "critical" });
  }
}

function _propagateContent(parts, payload) {
  if (parts[1] === "zone") {
    const zone = parts[2];
    DISPLAYS.filter(d => d.zone === zone).forEach(d => {
      if (state.displays[d.id]) {
        state.displays[d.id].currentContent = payload.content;
      }
    });
  } else if (parts[1] === "display") {
    const id = parts[2];
    if (state.displays[id]) state.displays[id].currentContent = payload.content;
  }
}

// ── Notifications ──────────────────────────────────────────────────────────
function _pushNotification(n) {
  n.id   = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  n.read = false;
  state.notifications.unshift(n);
  if (state.notifications.length > 500) state.notifications.length = 500;

  const critical = state.notifications.filter(x => !x.read && x.severity === "critical").length;
  const warn     = state.notifications.filter(x => !x.read && x.severity === "warn").length;
  state.unreadCritical = critical;
  _updateBadge(critical + warn, critical > 0 ? "critical" : "warn");
}

function _updateBadge(count, severity) {
  const el = document.getElementById("badge-notifications");
  if (!el) return;
  el.textContent = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  el.className   = "nav-badge" + (count > 0 ? " show" : "") + (severity === "critical" ? "" : " warn");
}

// ── Publish helper ─────────────────────────────────────────────────────────
function mqttPublish(topic, payload, qos = 1, retain = false) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  _ws.send(JSON.stringify({ type: "mqtt_publish", topic, payload, qos, retain }));
}

// ── Init ───────────────────────────────────────────────────────────────────
connectWS();
initRouting();
