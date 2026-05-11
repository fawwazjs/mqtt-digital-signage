"use strict";
// @ts-check

/**
 * @typedef {import("../../types/state").DisplayConfig} DisplayConfig
 * @typedef {import("../../types/state").DisplayState} DisplayState
 * @typedef {import("../../types/protocol").AlertTopic} AlertTopic
 * @typedef {import("../../types/protocol").ContentDisplayOverrideTopic} ContentDisplayOverrideTopic
 * @typedef {import("../../types/protocol").ContentZoneScheduleTopic} ContentZoneScheduleTopic
 * @typedef {import("../../types/protocol").DisplayCommandTopic} DisplayCommandTopic
 * @typedef {import("../../types/protocol").DisplayId} DisplayId
 * @typedef {import("../../types/protocol").ISO8601Timestamp} ISO8601Timestamp
 * @typedef {import("../../types/protocol").MaintenanceAlertTopic} MaintenanceAlertTopic
 * @typedef {import("../../types/protocol").MqttEnvelope} MqttEnvelope
 * @typedef {"online" | "offline" | "loading" | "degraded" | "emergency"} MapStatus
 */

// ── CartoDB Dark Matter ────────────────────────────────────────────────────
const _TILE_URL  = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const _TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// ── Module state ───────────────────────────────────────────────────────────
/** @type {L.Map | null} */
let _map     = null;
/** @type {Partial<Record<DisplayId, L.Marker>>} */
let _markers = {};     // display id → Leaflet marker
/** @type {Partial<Record<DisplayId, L.Circle>>} */
let _scopeCircles = {};
/** @type {DisplayId | null} */
let _panelId = null;   // currently open panel
/** @type {ReturnType<typeof setTimeout> | null} */
let _ttpShowTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _ttpHideTimer = null;
/** @type {HTMLElement | null} */
let _ttp   = null;     // tooltip DOM element
/** @type {HTMLElement | null} */
let _panel = null;     // panel DOM element
/** @type {HTMLElement | null} */
let _mapChrome = null;
/** @type {string} */
let _mapSearch = "";
/** @type {"all" | MapStatus} */
let _mapStatus = "all";

// ── Lifecycle hooks ────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
window.mount_map = function(el) {
  if (_map) { _map.invalidateSize(); _openPendingMapDisplay(); return; }
  _initMap(el);
  _openPendingMapDisplay();
};

/** @param {MqttEnvelope} msg */
window.onMsg_map = function(msg) {
  if (!_map) return;
  const parts = msg.topic.split("/");
  if (parts[0] === "display") {
    const id = /** @type {DisplayId} */ (parts[1]);
    _updateMarker(id);
    _refreshPanel(id);
    _renderMapChrome();
  } else if (parts[0] === "analytics") {
    const payload = /** @type {import("../../types/protocol").AnalyticsViewershipPayload} */ (msg.payload);
    _updateMarker(payload.screen_id);
    _refreshPanel(payload.screen_id);
    _renderMapChrome();
  } else if (parts[0] === "alert") {
    _updateAllMarkers();
    if (_panelId) _refreshPanel(_panelId);
    _renderMapChrome();
  } else if (parts[0] === "content" || parts[0] === "maintenance") {
    _renderMapChrome();
  }
};

// ── Map init ───────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
function _initMap(el) {
  const workspace = document.createElement("div");
  workspace.id = "map-workspace";

  const root = document.createElement("div");
  root.id = "map-root";
  workspace.appendChild(root);
  el.appendChild(workspace);

  _map = L.map(root, { zoomControl: false, attributionControl: true });
  L.control.zoom({ position: "bottomleft" }).addTo(_map);

  L.tileLayer(_TILE_URL, { attribution: _TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(_map);

  const bounds = L.latLngBounds(DISPLAYS.map(d => /** @type {const} */ ([d.lat, d.lng])));
  _map.fitBounds(bounds, { padding: [80, 80] });

  // Tooltip overlay — lives inside Leaflet container so container coords align
  _ttp = document.createElement("div");
  _ttp.className = "map-tooltip";
  root.appendChild(_ttp);

  _mapChrome = document.createElement("div");
  _mapChrome.id = "map-chrome";
  workspace.appendChild(_mapChrome);

  // Panel — sibling of map root, positioned absolute within #page-map
  _panel = document.createElement("div");
  _panel.className = "map-panel";
  el.appendChild(_panel);

  DISPLAYS.forEach(_createMarker);
  _renderMapChrome();

  _map.on("click", () => _closePanel());
  _map.on("zoom",  () => _onZoom());

  document.addEventListener("keydown", _onKeydown);
}

function _openPendingMapDisplay() {
  if (!window._pendingMapDisplay) return;
  const id = window._pendingMapDisplay;
  window._pendingMapDisplay = null;
  if (!_map) return;
  const cfg = DISPLAYS.find(d => d.id === id);
  if (cfg) {
    _map.setView([cfg.lat, cfg.lng], Math.max(_map.getZoom(), 16));
    _openPanel(id);
  }
}

/** @param {KeyboardEvent} e */
function _onKeydown(e) {
  if (e.key === "Escape") _closePanel();
}

function _onZoom() {
  const size = _zoomStep();
  Object.keys(_markers).forEach(id => {
    const displayId = /** @type {DisplayId} */ (id);
    const m = _markers[displayId];
    if (m) m.setIcon(_mkrIcon(displayId, _getStatus(displayId), size));
  });
}

// ── Marker helpers ─────────────────────────────────────────────────────────

function _zoomStep() {
  if (!_map) return 14;
  const z = _map.getZoom();
  if (z < 13) return 10;
  if (z > 15) return 18;
  return 14;
}

/**
 * @param {MapStatus} status
 * @param {number} size
 */
function _mkrIcon(id, status, size) {
  const viewers = state.displayViewers[id]?.viewer_count;
  const scaled = Math.max(size, _markerSize(id));
  return L.divIcon({
    className: "",
    html: `<div class="mkr mkr-${status}" style="width:${scaled}px;height:${scaled}px" aria-hidden="true">
             <div class="mkr-ring"></div><div class="mkr-dot"></div><div class="mkr-count">${viewers == null ? "–" : _esc(viewers)}</div>
           </div>`,
    iconSize:   [scaled, scaled],
    iconAnchor: [scaled / 2, scaled / 2],
  });
}

/** @param {DisplayConfig} cfg */
function _createMarker(cfg) {
  if (!_map) return;
  const st = _getStatus(cfg.id);
  _scopeCircles[cfg.id] = L.circle([cfg.lat, cfg.lng], {
    radius: cfg.scopeMeters || 70,
    color: _statusColor(st),
    weight: 1,
    opacity: 0.48,
    fillColor: _statusColor(st),
    fillOpacity: 0.08,
    interactive: false,
  }).addTo(_map);
  const m = L.marker([cfg.lat, cfg.lng], {
    icon: _mkrIcon(cfg.id, st, _markerSize(cfg.id)),
    riseOnHover: true,
  }).addTo(_map);
  m.getElement()?.setAttribute("aria-label", _markerAria(cfg.id));

  m.on("mouseover", e => {
    if (_ttpShowTimer) clearTimeout(_ttpShowTimer);
    if (_ttpHideTimer) clearTimeout(_ttpHideTimer);
    _ttpShowTimer = setTimeout(() => _showTtp(cfg.id, e.containerPoint), 150);
  });
  m.on("mouseout", () => {
    if (_ttpShowTimer) clearTimeout(_ttpShowTimer);
    _ttpHideTimer = setTimeout(_hideTtp, 100);
  });
  m.on("click", e => {
    L.DomEvent.stopPropagation(e);
    _openPanel(cfg.id);
  });

  _markers[cfg.id] = m;
}

/** @param {DisplayId} id */
function _updateMarker(id) {
  const m = _markers[id];
  if (!m) return;
  const st = _getStatus(id);
  m.setIcon(_mkrIcon(id, st, _markerSize(id)));
  m.getElement()?.setAttribute("aria-label", _markerAria(id));
  const circle = _scopeCircles[id];
  if (circle) {
    circle.setStyle({ color: _statusColor(st), fillColor: _statusColor(st) });
  }
}

function _updateAllMarkers() {
  Object.keys(_markers).forEach(id => _updateMarker(/** @type {DisplayId} */ (id)));
}

// ── Status resolution ──────────────────────────────────────────────────────

/**
 * @param {DisplayId} id
 * @returns {MapStatus}
 */
function _getStatus(id) {
  const cfg = DISPLAYS.find(d => d.id === id);
  for (const topic of Object.keys(state.alerts)) {
    if (_alertAffects(/** @type {AlertTopic} */ (topic), cfg)) return "emergency";
  }
  const d = state.displays[id];
  if (!d || !d.lastHealthAt) return "loading";
  if (d.status === "offline")  return "offline";
  if ((d.temp || 0) >= 60)    return "degraded";
  return "online";
}

/**
 * @param {AlertTopic | string} topic
 * @param {DisplayConfig | undefined} cfg
 */
function _alertAffects(topic, cfg) {
  if (!cfg) return false;
  const p = topic.split("/");
  // alert/{scope}/{scope_id}/emergency
  if (p[1] === "network")  return true;
  if (p[1] === "building") return cfg.building === p[2];
  if (p[1] === "zone")     return cfg.zone === p[2];
  if (p[1] === "display")  return cfg.id === p[2];
  return false;
}

// ── Tooltip ────────────────────────────────────────────────────────────────

/**
 * @param {DisplayId} id
 * @param {L.Point} pt
 */
function _showTtp(id, pt) {
  if (!_ttp) return;
  _ttp.innerHTML  = _buildTtpHtml(id);
  _ttp.style.left = pt.x + "px";
  _ttp.style.top  = pt.y + "px";
  _ttp.classList.add("visible");
}

function _hideTtp() {
  if (!_ttp) return;
  _ttp.classList.remove("visible");
}

/** @param {DisplayId} id */
function _buildTtpHtml(id) {
  const cfg  = DISPLAYS.find(d => d.id === id);
  const d    = state.displays[id];
  const st   = _getStatus(id);
  const zone = cfg ? ZONES[cfg.zone] : undefined;
  const labels = { online: "Online", offline: "Offline", loading: "Waiting", degraded: "Degraded", emergency: "Emergency" };
  const viewers = state.displayViewers[id]?.viewer_count;
  const scope = cfg?.scopeMeters ?? 70;
  return `<div class="ttp-name">${_esc(cfg?.name || id)}</div>
          <div class="ttp-id">${_esc(id)}</div>
          <div class="ttp-status"><span class="status-dot ${st}"></span><span>${labels[st] || st}</span></div>
          <div class="ttp-coords">lat: ${cfg?.lat ?? "—"}, lng: ${cfg?.lng ?? "—"}</div>
          <div class="ttp-zone">${_esc(cfg?.building || "—")} — ${_esc(zone?.label || cfg?.zone || "—")}</div>
          <div class="ttp-zone">Viewers: ${viewers ?? "No data"} / Scope: ${scope}m</div>
          <div class="ttp-uptime">Last heartbeat: ${_timeAgo(d?.lastHealthAt)}</div>`;
}

/** @param {DisplayId} id */
function _markerSize(id) {
  return _zoomStep() + Math.min(18, Math.round(Math.sqrt(state.displayViewers[id]?.viewer_count || 0) * 2.2));
}

/** @param {MapStatus} st */
function _statusColor(st) {
  if (st === "online") return "#35D07F";
  if (st === "offline" || st === "emergency") return "#FF375F";
  if (st === "degraded") return "#FFB020";
  return "#4DA3FF";
}

/** @param {DisplayId} id */
function _markerAria(id) {
  const cfg = DISPLAYS.find(d => d.id === id);
  const viewers = state.displayViewers[id]?.viewer_count;
  return `${cfg?.name || id}, ${_getStatus(id)}, ${viewers ?? "no"} viewers, scope ${cfg?.scopeMeters || 70} meters`;
}

// ── Panel ──────────────────────────────────────────────────────────────────

/** @param {DisplayId} id */
function _openPanel(id) {
  if (!_panel) return;
  _panelId = id;
  _panel.innerHTML = _renderPanel(id);
  _panel.classList.remove("closing");
  _panel.classList.add("open");
  _bindPanelEvents(id);
  _renderMapChrome();
}

function _closePanel() {
  if (!_panelId || !_panel) return;
  const panel = _panel;
  _panelId = null;
  panel.classList.add("closing");
  panel.addEventListener("transitionend", () => {
    panel.classList.remove("open", "closing");
    panel.innerHTML = "";
    _renderMapChrome();
  }, { once: true });
}

// ── Cockpit chrome ─────────────────────────────────────────────────────────

/** @param {boolean} [force] */
function _renderMapChrome(force = false) {
  if (!_mapChrome) return;
  const active = document.activeElement;
  if (!force && active instanceof HTMLInputElement && active.id === "map-search") return;

  const counts = _fleetCounts();
  const visible = _filteredDisplays();
  _mapChrome.innerHTML = `
    <section class="map-command" aria-label="Map controls">
      <div class="map-command-head">
        <div>
          <div class="map-eyebrow">Fleet map</div>
          <div class="map-title">ITS Signage Network</div>
        </div>
        <button class="map-refresh" id="map-fit" aria-label="Fit all displays">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4"/>
          </svg>
        </button>
      </div>
      <div class="map-searchbox">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <circle cx="9" cy="9" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/>
        </svg>
        <input id="map-search" value="${_esc(_mapSearch)}" placeholder="Search display, zone, building" autocomplete="off">
      </div>
      <div class="map-status-grid">
        ${_statusChip("all", "All", DISPLAYS.length)}
        ${_statusChip("online", "Online", counts.online)}
        ${_statusChip("offline", "Offline", counts.offline)}
        ${_statusChip("degraded", "Degraded", counts.degraded)}
      </div>
      <div class="map-zone-block">
        <div class="map-block-title">Zones</div>
        ${_zoneRows()}
      </div>
      <div class="map-legend" aria-label="Marker legend">
        <span><i class="legend-dot"></i> Size = viewer count</span>
        <span><i class="legend-ring"></i> Ring = coverage scope</span>
      </div>
    </section>

    <section class="map-fleet-panel" aria-label="Display fleet">
      <div class="map-panel-head">
        <span>Displays</span>
        <span>${visible.length}/${DISPLAYS.length}</span>
      </div>
      <div class="map-display-list">
        ${visible.map(_displayRow).join("") || `<div class="map-empty">No displays match filter.</div>`}
      </div>
    </section>

    <section class="map-incident-strip" aria-label="Recent events">
      <div class="map-strip-title">Live events</div>
      <div class="map-strip-feed">${_recentMapEvents()}</div>
    </section>`;

  _bindMapChrome();
}

/**
 * @param {"all" | MapStatus} status
 * @param {string} label
 * @param {number} count
 */
function _statusChip(status, label, count) {
  return `<button class="map-status-chip ${_mapStatus === status ? "active" : ""}" data-status="${status}">
    <span>${_esc(label)}</span><strong>${count}</strong>
  </button>`;
}

function _fleetCounts() {
  /** @type {Record<MapStatus, number>} */
  const counts = { online: 0, offline: 0, loading: 0, degraded: 0, emergency: 0 };
  DISPLAYS.forEach(d => { counts[_getStatus(d.id)]++; });
  return counts;
}

/** @returns {DisplayConfig[]} */
function _filteredDisplays() {
  let list = [...DISPLAYS];
  if (_mapStatus !== "all") list = list.filter(d => _getStatus(d.id) === _mapStatus);
  if (_mapSearch) {
    const q = _mapSearch.toLowerCase();
    list = list.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q) ||
      d.zone.toLowerCase().includes(q) ||
      d.building.toLowerCase().includes(q)
    );
  }
  const order = { emergency: 0, offline: 1, degraded: 2, loading: 3, online: 4 };
  list.sort((a, b) => (order[_getStatus(a.id)] ?? 9) - (order[_getStatus(b.id)] ?? 9) || a.name.localeCompare(b.name));
  return list;
}

function _zoneRows() {
  return Object.entries(ZONES).map(([zoneId, zone]) => {
    const displays = DISPLAYS.filter(d => d.zone === zoneId);
    const offline = displays.filter(d => _getStatus(d.id) === "offline").length;
    return `<button class="map-zone-row" data-zone="${_esc(zoneId)}">
      <span>${_esc(zone?.label ?? zoneId)}</span>
      <span>${displays.length} displays${offline ? ` / ${offline} offline` : ""}</span>
    </button>`;
  }).join("");
}

/** @param {DisplayConfig} cfg */
function _displayRow(cfg) {
  const st = _getStatus(cfg.id);
  const d = state.displays[cfg.id];
  const content = _displayContent(cfg.id);
  const viewers = state.displayViewers[cfg.id]?.viewer_count;
  const selected = _panelId === cfg.id ? " selected" : "";
  return `<button class="map-display-row${selected}" data-display="${_esc(cfg.id)}">
    <span class="map-row-status ${st}"></span>
    <span class="map-row-main">
      <span class="map-row-name">${_esc(cfg.name)}</span>
      <span class="map-row-meta">${_esc(cfg.id)} / ${_esc(cfg.building)} / ${_esc(ZONES[cfg.zone]?.label ?? cfg.zone)}</span>
    </span>
    <span class="map-row-side">
      <span>${viewers == null ? "No viewers" : `${viewers} viewers`}</span>
      <span>${_esc(content || "No content")}</span>
      <span>${_timeAgo(d?.lastHealthAt)}</span>
    </span>
  </button>`;
}

/** @param {DisplayId} id */
function _displayContent(id) {
  const d = state.displays[id];
  if (d?.currentContent) return d.currentContent;
  const cfg = DISPLAYS.find(x => x.id === id);
  const zoneTopic = cfg ? `content/zone/${cfg.zone}/schedule` : "";
  const directTopic = `content/display/${id}/override`;
  return state.contentSchedules[/** @type {ContentDisplayOverrideTopic} */ (directTopic)]?.content
      || state.contentSchedules[/** @type {ContentZoneScheduleTopic} */ (zoneTopic)]?.content
      || null;
}

function _recentMapEvents() {
  const events = state.auditLog
    .filter(e => e.topic.startsWith("display/") || e.topic.startsWith("alert/") || e.topic.startsWith("maintenance/"))
    .slice(0, 6);
  if (!events.length) return `<div class="map-strip-empty">Waiting for MQTT traffic.</div>`;
  return events.map(e => {
    const kind = e.topic.split("/")[0] || "event";
    return `<button class="map-event-pill" data-topic="${_esc(e.topic)}">
      <span>${_esc(kind)}</span>
      <strong>${_esc(e.topic)}</strong>
      <em>${_timeAgo(e.timestamp)}</em>
    </button>`;
  }).join("");
}

function _bindMapChrome() {
  if (!_mapChrome) return;
  _mapChrome.querySelector("#map-search")?.addEventListener("input", e => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    _mapSearch = target.value;
    _renderMapChrome(true);
    const input = document.getElementById("map-search");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });

  _mapChrome.querySelector("#map-fit")?.addEventListener("click", _fitAllDisplays);

  _mapChrome.querySelectorAll("[data-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      const status = /** @type {"all" | MapStatus} */ (/** @type {HTMLElement} */ (btn).dataset.status ?? "all");
      _mapStatus = status;
      _renderMapChrome();
    });
  });

  _mapChrome.querySelectorAll("[data-display]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = /** @type {DisplayId | undefined} */ (/** @type {HTMLElement} */ (btn).dataset.display);
      if (id) _focusDisplay(id);
    });
  });

  _mapChrome.querySelectorAll("[data-zone]").forEach(btn => {
    btn.addEventListener("click", () => {
      const zone = /** @type {string | undefined} */ (/** @type {HTMLElement} */ (btn).dataset.zone);
      if (!zone || !_map) return;
      const displays = DISPLAYS.filter(d => d.zone === zone);
      if (!displays.length) return;
      _map.fitBounds(L.latLngBounds(displays.map(d => /** @type {const} */ ([d.lat, d.lng]))), { padding: [110, 110] });
    });
  });
}

/** @param {DisplayId} id */
function _focusDisplay(id) {
  if (!_map) return;
  const cfg = DISPLAYS.find(d => d.id === id);
  if (!cfg) return;
  _map.setView([cfg.lat, cfg.lng], Math.max(_map.getZoom(), 16), { animate: true });
  _openPanel(id);
}

function _fitAllDisplays() {
  if (!_map) return;
  const bounds = L.latLngBounds(DISPLAYS.map(d => /** @type {const} */ ([d.lat, d.lng])));
  _map.fitBounds(bounds, { padding: [110, 110] });
}

/** @param {DisplayId} id */
function _refreshPanel(id) {
  if (_panelId !== id || !_panel) return;
  if (_panel.querySelector(".override-input")) return; // user is typing
  const scrollTop = _panel.querySelector(".panel-scroll")?.scrollTop ?? 0;
  _panel.innerHTML = _renderPanel(id);
  _bindPanelEvents(id);
  const sc = _panel.querySelector(".panel-scroll");
  if (sc instanceof HTMLElement) sc.scrollTop = scrollTop;
}

// ── Panel render ───────────────────────────────────────────────────────────

/** @param {DisplayId} id */
function _renderPanel(id) {
  const cfg  = DISPLAYS.find(d => d.id === id);
  const st   = _getStatus(id);
  const zone = cfg ? ZONES[cfg.zone] : undefined;
  const labels = { online: "Online", offline: "Offline", loading: "Waiting", degraded: "Degraded", emergency: "Emergency" };

  return `
    <button class="panel-close" id="pnl-close">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
      </svg>
    </button>
    <div class="panel-scroll">

      <div class="panel-section">
        <div class="pnl-name">${_esc(cfg?.name || id)}</div>
        <div class="pnl-id">${_esc(id)}</div>
        <div class="pnl-badges"><span class="spill ${st}">${labels[st] || st}</span></div>
        <div class="pnl-breadcrumb">
          <span>${_esc(cfg?.building || "—")}</span> /
          <span>${_esc(zone?.label || cfg?.zone || "—")}</span>
          ${cfg?.floor != null ? ` / <span>Floor ${cfg.floor}</span>` : ""}
        </div>
      </div>

      <div class="panel-section">
        <div class="section-heading">Live Preview</div>
        ${_buildPreview(id)}
      </div>

      <div class="panel-section">
        <div class="section-heading">Health</div>
        ${_buildHealth(id)}
      </div>

      <div class="panel-section">
        <div class="section-heading">Viewer Metrics</div>
        ${_buildViewerMetrics(id)}
      </div>

      <div class="panel-section">
        <div class="section-heading">Recent Events</div>
        ${_buildEvents(id)}
      </div>

      <div class="panel-section">
        <div class="section-heading">Actions</div>
        ${_buildActions(id)}
      </div>

    </div>`;
}

/** @param {DisplayId} id */
function _buildViewerMetrics(id) {
  const a = state.displayViewers[id];
  const cfg = DISPLAYS.find(d => d.id === id);
  if (!a) return `<p class="t-small">No viewer analytics yet.</p>`;
  return `<div class="health-grid">
    <div><div class="health-label">Viewers</div><div class="health-value">${a.viewer_count}</div></div>
    <div><div class="health-label">Dwell</div><div class="health-value">${a.dwell_time}s</div></div>
    <div><div class="health-label">Period</div><div class="health-value">${_esc(a.peak_period)}</div></div>
    <div><div class="health-label">Scope</div><div class="health-value">${cfg?.scopeMeters || 70}m</div></div>
  </div>`;
}

/** @param {DisplayId} id */
function _buildPreview(id) {
  const d   = state.displays[id];
  const cfg = DISPLAYS.find(x => x.id === id);

  if (d?.status === "offline") {
    return `<div class="pnl-preview pnl-preview--offline">
      <div class="pnl-preview-label">Display Offline</div>
      <div class="pnl-preview-sub">Last seen ${_timeAgo(d.lastStatusAt)}</div>
    </div>`;
  }

  if (!d?.currentContent) {
    return `<div class="pnl-preview pnl-preview--loading">
      <div class="pnl-preview-title">Awaiting Content Assignment</div>
    </div>`;
  }

  // Pull type/campaign metadata from content schedule user properties
  const overrideTopic  = /** @type {ContentDisplayOverrideTopic} */ (`content/display/${id}/override`);
  const scheduleTopic  = cfg?.zone ? /** @type {ContentZoneScheduleTopic} */ (`content/zone/${cfg.zone}/schedule`) : null;
  const sched          = state.contentSchedules[overrideTopic]
                      || (scheduleTopic ? state.contentSchedules[scheduleTopic] : null)
                      || null;
  const up             = sched?.user_properties || {};
  const contentType    = up.content_type || "";
  const campaignId     = up.campaign_id  || "";
  const duration       = up.duration     || "";
  const mediaUrl       = sched?.media_url || "";
  const mediaType      = sched?.media_type || "";

  return `<div class="pnl-preview pnl-preview--active">
    ${mediaUrl && mediaType === "video" ? `<video class="pnl-preview-media" src="${_esc(mediaUrl)}" muted autoplay loop playsinline></video>` : ""}
    ${mediaUrl && mediaType === "image" ? `<img class="pnl-preview-media" src="${_esc(mediaUrl)}" alt="">` : ""}
    <div class="pnl-preview-title">${_esc(d.currentContent)}</div>
    <div class="pnl-preview-meta">
      ${contentType ? `<span class="ctype-badge">${_esc(contentType)}</span>` : ""}
      ${campaignId  ? `<span class="t-ts">${_esc(campaignId)}</span>` : ""}
      ${duration    ? `<span class="t-ts">${_esc(duration)}s</span>` : ""}
    </div>
  </div>`;
}

/** @param {DisplayId} id */
function _buildHealth(id) {
  const d = state.displays[id];
  if (!d?.lastHealthAt) return `<p class="t-small">No health data yet.</p>`;

  const temp    = d.temp   != null ? d.temp   : null;
  const tempCls = temp != null ? (temp >= 65 ? "crit" : temp >= 50 ? "warn" : "") : "";

  return `<div class="health-grid">
    <div>
      <div class="health-label">Temperature</div>
      <div class="health-value ${tempCls}">${temp != null ? `${temp}°C` : "—"}</div>
    </div>
    <div>
      <div class="health-label">CPU</div>
      <div class="health-value">${d.cpu != null ? `${d.cpu}%` : "—"}</div>
    </div>
    <div>
      <div class="health-label">Memory</div>
      <div class="health-value">${d.memory != null ? `${d.memory}MB` : "—"}</div>
    </div>
    <div>
      <div class="health-label">Last Heartbeat</div>
      <div class="health-value" style="font-size:12px" title="${_esc(_fmtTs(d.lastHealthAt))}">${_timeAgo(d.lastHealthAt)}</div>
    </div>
  </div>`;
}

/** @param {DisplayId} id */
function _buildEvents(id) {
  const cfg  = DISPLAYS.find(d => d.id === id);
  const zone = cfg?.zone;

  const events = state.auditLog.filter(e => {
    const t = e.topic;
    return t === `display/${id}/health`            ||
           t === `display/${id}/status`            ||
           t === `content/display/${id}/override`  ||
           t === `maintenance/${id}/alert`         ||
           (zone && t === `content/zone/${zone}/schedule`) ||
           (t.startsWith("alert/") && _alertAffects(t, cfg));
  }).slice(0, 5);

  const auditLink = `<a class="audit-link" data-audit-id="${_esc(id)}" href="#">View all in Audit Log →</a>`;

  if (!events.length) return `<p class="t-small">No events yet.</p>${auditLink}`;

  return events.map(e => {
    const p = e.topic.split("/");
    let label;
    if (p[2] === "status")                                 label = `Status → ${_esc(_payloadField(e.payload, "status", "?"))}`;
    else if (p[2] === "health")                            label = `Heartbeat — ${_esc(_payloadField(e.payload, "status", "online"))}`;
    else if (p[0] === "alert")                             label = `Emergency: ${_esc(_payloadField(e.payload, "message", "Alert"))}`;
    else if (p[0] === "content")                           label = `Content → ${_esc(_payloadField(e.payload, "content", "?"))}`;
    else if (p[0] === "maintenance")                       label = `Maintenance: ${_esc(_payloadField(e.payload, "reason", "flagged"))}`;
    else                                                   label = _esc(e.topic);
    return `<div class="event-item">
      <span class="event-ts">${_fmtTs(e.timestamp)}</span>
      <span class="event-text">${label}</span>
    </div>`;
  }).join("") + auditLink;
}

/** @param {DisplayId} id */
function _buildActions(id) {
  const offline = (state.displays[id] || {}).status === "offline";
  const dis     = offline ? " disabled" : "";
  return `<div class="action-group">
    <button class="btn-primary" id="act-override"${dis}>Override Content</button>
    <div id="override-wrap"></div>
    <button class="btn-amber"   id="act-restart"${dis}>Restart Display</button>
    <div id="restart-wrap"></div>
    <button class="btn-ghost"   id="act-maint">Mark for Maintenance</button>
  </div>`;
}

// ── Panel event binding ────────────────────────────────────────────────────

/** @param {DisplayId} id */
function _bindPanelEvents(id) {
  if (!_panel) return;
  /** @param {string} s */
  const $  = s => _panel?.querySelector(s) || null;
  /** @param {string} s */
  const $$ = s => _panel?.querySelectorAll(s) || document.querySelectorAll("__never__");

  $("#pnl-close")?.addEventListener("click", _closePanel);

  // Override content
  $("#act-override")?.addEventListener("click", () => {
    const wrap = $("#override-wrap");
    if (!wrap || wrap.children.length) return;
    wrap.innerHTML = `<div class="override-form">
      <input class="override-input" id="ov-input" placeholder="Content name..." autocomplete="off">
      <div class="override-row">
        <button class="btn-primary" id="ov-submit">Publish</button>
        <button class="btn-ghost"   id="ov-cancel">Cancel</button>
      </div>
    </div>`;
    $("#ov-submit")?.addEventListener("click", () => {
      const input = /** @type {HTMLInputElement | null} */ ($("#ov-input"));
      const val = (input?.value || "").trim();
      if (!val) return;
      mqttPublish(/** @type {ContentDisplayOverrideTopic} */ (`content/display/${id}/override`), { content: val }, 1, true);
      wrap.innerHTML = "";
    });
    $("#ov-cancel")?.addEventListener("click", () => { wrap.innerHTML = ""; });
    /** @type {HTMLInputElement | null} */ ($("#ov-input"))?.focus();
  });

  // Restart — inline confirm
  $("#act-restart")?.addEventListener("click", () => {
    const wrap = $("#restart-wrap");
    if (!wrap || wrap.children.length) return;
    wrap.innerHTML = `<div class="confirm-inline">
      <span>Confirm restart?</span>
      <button class="btn-amber" id="rs-yes">Restart</button>
      <button class="btn-ghost" id="rs-no">Cancel</button>
    </div>`;
    $("#rs-yes")?.addEventListener("click", () => {
      mqttPublish(/** @type {DisplayCommandTopic} */ (`display/${id}/command`), { command: "restart" }, 1, false);
      wrap.innerHTML = "";
    });
    $("#rs-no")?.addEventListener("click", () => { wrap.innerHTML = ""; });
  });

  // Mark for maintenance
  $("#act-maint")?.addEventListener("click", () => {
    mqttPublish(/** @type {MaintenanceAlertTopic} */ (`maintenance/${id}/alert`), {
      display_id: id, reason: "operator_flagged", timestamp: /** @type {import("../../types/protocol").UnixSeconds} */ (Date.now() / 1000),
    }, 1, false);
  });

  // Audit log link — passes display ID as pre-filter to audit page
  $$("[data-audit-id]").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      window._auditPendingDisplay = /** @type {DisplayId} */ (a.getAttribute("data-audit-id"));
      navigateTo("audit");
    });
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────

/** @param {unknown} s */
function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * @param {unknown} payload
 * @param {string} key
 * @param {string} fallback
 */
function _payloadField(payload, key, fallback) {
  if (payload === null || Object(payload) !== payload || Array.isArray(payload)) return fallback;
  const value = /** @type {Record<string, unknown>} */ (payload)[key];
  return value == null ? fallback : String(value);
}

/** @param {ISO8601Timestamp | undefined} ts */
function _timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
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
