"use strict";
// @ts-check

/** @typedef {import("../../types/protocol").MqttEnvelope} MqttEnvelope */
/** @typedef {import("../../types/protocol").ZoneId} ZoneId */
/** @typedef {import("../../types/protocol").DisplayId} DisplayId */

/** @type {HTMLElement | null} */
let _anRoot = null;
/** @type {"15m" | "1h" | "6h" | "24h"} */
let _anRange = "1h";
/** @type {ZoneId | "all"} */
let _anZone = "all";

window.mount_analytics = function(el) {
  if (_anRoot && el.querySelector("#analytics-root")) {
    _renderAnalytics();
    return;
  }
  _anRoot = el;
  el.innerHTML = `<div id="analytics-root"></div>`;
  _renderAnalytics();
};

/** @param {MqttEnvelope} _msg */
window.onMsg_analytics = function(_msg) {
  if (!_anRoot) return;
  _renderAnalytics();
};

function _renderAnalytics() {
  const root = document.getElementById("analytics-root");
  if (!root) return;
  const rows = _analyticsRows();
  const filtered = _filterRows(rows);
  const totalViewers = filtered.reduce((n, r) => n + r.viewers, 0);
  const avgDwell = filtered.length ? Math.round(filtered.reduce((n, r) => n + r.dwell, 0) / filtered.length) : 0;
  const offline = DISPLAYS.filter(d => state.displays[d.id]?.status === "offline").length;
  const contentEvents = _recentEntries("content").length;

  root.innerHTML = `
    <div class="an-toolbar">
      <div>
        <div class="an-title">Analytics</div>
        <div class="an-sub">ITS fleet metrics from MQTT streams</div>
      </div>
      <div class="an-controls">
        <select id="an-zone">${_zoneOptions()}</select>
        <select id="an-range">
          <option value="15m">15 min</option><option value="1h">1 hour</option>
          <option value="6h">6 hours</option><option value="24h">24 hours</option>
        </select>
      </div>
    </div>
    <div class="an-kpis">
      ${_kpi("Viewer samples", filtered.length)}
      ${_kpi("Total viewers", totalViewers)}
      ${_kpi("Avg dwell", `${avgDwell}s`)}
      ${_kpi("Offline displays", offline)}
      ${_kpi("Content events", contentEvents)}
    </div>
    <div class="an-grid">
      ${_panel("Viewer trend", _lineChart(filtered), _tableText("Viewer trend over selected range."))}
      ${_panel("Health distribution", _barChart(_healthDistribution()), _tableFromObject(_healthDistribution()))}
      ${_panel("Alert severity", _barChart(_alertBreakdown()), _tableFromObject(_alertBreakdown()))}
      ${_panel("Content activity", _barChart(_contentActivity()), _tableFromObject(_contentActivity()))}
      ${_panel("Zone comparison", _zoneComparison(filtered), _zoneTable(filtered))}
      ${_panel("Detail table", _detailTable(filtered), "Raw viewer samples by display and zone.")}
    </div>`;

  const zone = /** @type {HTMLSelectElement | null} */ (root.querySelector("#an-zone"));
  const range = /** @type {HTMLSelectElement | null} */ (root.querySelector("#an-range"));
  if (zone) zone.value = _anZone;
  if (range) range.value = _anRange;
  zone?.addEventListener("change", e => { _anZone = /** @type {ZoneId | "all"} */ (/** @type {HTMLSelectElement} */ (e.target).value); _renderAnalytics(); });
  range?.addEventListener("change", e => { _anRange = /** @type {typeof _anRange} */ (/** @type {HTMLSelectElement} */ (e.target).value); _renderAnalytics(); });
}

function _analyticsRows() {
  return state.auditLog
    .filter(e => e.topic.startsWith("analytics/zone/"))
    .map(e => {
      const p = /** @type {{screen_id?: DisplayId, zone_id?: ZoneId, viewer_count?: number, dwell_time?: number}} */ (e.payload);
      return { ts: e.timestamp, display: p.screen_id || "", zone: p.zone_id || /** @type {ZoneId} */ (e.topic.split("/")[2]), viewers: Number(p.viewer_count || 0), dwell: Number(p.dwell_time || 0) };
    });
}

/** @param {ReturnType<typeof _analyticsRows>} rows */
function _filterRows(rows) {
  const cutoff = Date.now() - ({ "15m": 900000, "1h": 3600000, "6h": 21600000, "24h": 86400000 }[_anRange]);
  return rows.filter(r => (_anZone === "all" || r.zone === _anZone) && new Date(r.ts).getTime() >= cutoff).reverse();
}

function _zoneOptions() {
  return `<option value="all">All zones</option>` + Object.entries(ZONES).map(([id, z]) => `<option value="${_esc(id)}">${_esc(z?.label || id)}</option>`).join("");
}

/** @param {string} label @param {string | number} value */
function _kpi(label, value) {
  return `<div class="an-kpi"><span>${_esc(label)}</span><strong>${_esc(value)}</strong></div>`;
}

/** @param {string} title @param {string} body @param {string} sr */
function _panel(title, body, sr) {
  return `<section class="an-panel"><div class="an-panel-head">${_esc(title)}</div>${body}<p class="sr-only">${_esc(sr)}</p></section>`;
}

/** @param {ReturnType<typeof _analyticsRows>} rows */
function _lineChart(rows) {
  const vals = rows.slice(-32).map(r => r.viewers);
  if (!vals.length) return `<div class="an-empty">No viewer samples.</div>`;
  const max = Math.max(1, ...vals);
  const points = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * 100},${46 - (v / max) * 40}`).join(" ");
  return `<svg class="an-chart" viewBox="0 0 100 52" role="img" aria-label="Viewer trend chart"><polyline points="${points}" fill="none" stroke="var(--signal-cyan)" stroke-width="2"/><path d="M0 46H100" stroke="var(--border)"/></svg>`;
}

/** @param {Record<string, number>} data */
function _barChart(data) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([,v]) => v));
  return `<div class="an-bars">${entries.map(([k,v]) => `<div class="an-bar-row"><span>${_esc(k)}</span><div><i style="width:${Math.max(3, (v / max) * 100)}%"></i></div><b>${v}</b></div>`).join("")}</div>`;
}

function _healthDistribution() {
  const out = { online: 0, offline: 0, degraded: 0, waiting: 0 };
  DISPLAYS.forEach(d => {
    const s = state.displays[d.id];
    if (!s?.lastHealthAt) out.waiting++;
    else if (s.status === "offline") out.offline++;
    else if ((s.temp || 0) >= 60) out.degraded++;
    else out.online++;
  });
  return out;
}

function _alertBreakdown() {
  const out = { critical: 0, warning: 0, info: 0 };
  state.auditLog.filter(e => e.topic.startsWith("alert/")).forEach(e => {
    const p = /** @type {{severity?: string, status?: string}} */ (e.payload);
    if (p.status === "cleared") out.info++;
    else if (p.severity === "warn" || p.severity === "warning") out.warning++;
    else out.critical++;
  });
  return out;
}

function _contentActivity() {
  const out = { zone: 0, display: 0, removed: 0 };
  state.auditLog.filter(e => e.topic.startsWith("content/")).forEach(e => {
    const p = /** @type {{status?: string}} */ (e.payload);
    if (p.status === "removed") out.removed++;
    else if (e.topic.startsWith("content/display/")) out.display++;
    else out.zone++;
  });
  return out;
}

/** @param {ReturnType<typeof _analyticsRows>} rows */
function _zoneComparison(rows) {
  /** @type {Record<string, number>} */
  const out = {};
  rows.forEach(r => { out[r.zone] = (out[r.zone] || 0) + r.viewers; });
  return _barChart(out);
}

/** @param {ReturnType<typeof _analyticsRows>} rows */
function _zoneTable(rows) {
  const totals = {};
  rows.forEach(r => { totals[r.zone] = (totals[r.zone] || 0) + r.viewers; });
  return _tableFromObject(totals);
}

/** @param {ReturnType<typeof _analyticsRows>} rows */
function _detailTable(rows) {
  const body = rows.slice(-40).reverse().map(r => `<tr><td>${_fmtTs(r.ts)}</td><td>${_esc(r.display)}</td><td>${_esc(r.zone)}</td><td>${r.viewers}</td><td>${r.dwell}s</td></tr>`).join("");
  return `<table class="an-table"><thead><tr><th>Time</th><th>Display</th><th>Zone</th><th>Viewers</th><th>Dwell</th></tr></thead><tbody>${body || `<tr><td colspan="5">No rows.</td></tr>`}</tbody></table>`;
}

/** @param {string} prefix */
function _recentEntries(prefix) { return state.auditLog.filter(e => e.topic.startsWith(`${prefix}/`)); }
/** @param {Record<string, number>} obj */
function _tableFromObject(obj) { return Object.entries(obj).map(([k,v]) => `${k}: ${v}`).join(", "); }
/** @param {string} s */
function _tableText(s) { return s; }
