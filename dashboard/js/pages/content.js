"use strict";
// @ts-check

/**
 * @typedef {import("../../types/state").DisplayConfig} DisplayConfig
 * @typedef {import("../../types/state").AlertTypeConfig} AlertTypeConfig
 * @typedef {import("../../types/state").AuditLogEntry} AuditLogEntry
 * @typedef {import("../../types/protocol").AlertScope} AlertScope
 * @typedef {import("../../types/protocol").AlertSeverity} AlertSeverity
 * @typedef {import("../../types/protocol").AlertTopic} AlertTopic
 * @typedef {import("../../types/protocol").AlertType} AlertType
 * @typedef {import("../../types/protocol").BuildingId} BuildingId
 * @typedef {import("../../types/protocol").ContentDisplayOverrideTopic} ContentDisplayOverrideTopic
 * @typedef {import("../../types/protocol").ContentZoneScheduleTopic} ContentZoneScheduleTopic
 * @typedef {import("../../types/protocol").DisplayId} DisplayId
 * @typedef {import("../../types/protocol").MqttEnvelope} MqttEnvelope
 * @typedef {import("../../types/protocol").MqttQos} MqttQos
 * @typedef {import("../../types/protocol").ZoneId} ZoneId
 */

/**
 * @typedef {object} ContentLibraryItem
 * @property {string} id
 * @property {string} name
 * @property {"Video" | "HTML" | "Image"} type
 * @property {string} duration
 * @property {string} size
 * @property {string} date
 * @property {string} [url]
 * @property {string} [mime]
 * @property {string} [filename]
 */

/**
 * @typedef {object} ConfirmOptions
 * @property {string} title
 * @property {string} body
 * @property {string} confirmLabel
 * @property {string} [confirmCls]
 * @property {() => void} onConfirm
 */

// ── Module state ──────────────────────────────────────────────────────────────
/** @type {HTMLElement | null} */
let _cmRoot       = null;
/** @type {string | null} */
let _selContent   = null;
/** @type {AlertType | null} */
let _selAlertType = null;
/** @type {boolean} */
let _showAssign   = false;
/** @type {boolean} */
let _showHistory  = false;
/** @type {HTMLElement | null} */
let _confirm      = null;
/** @type {HTMLElement | null} */
let _toastEl      = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _toastTimer   = null;

// ── Content library. Seeded items + real uploaded media from dashboard server.
/** @type {ContentLibraryItem[]} */
let _LIB = [
  { id: "c001", name: "ITS Campus Welcome",        type: "Video", duration: "30s", size: "45 MB",  date: "2026-04-12" },
  { id: "c002", name: "Library Hours Board",       type: "HTML",  duration: "60s", size: "2 MB",   date: "2026-05-01" },
  { id: "c003", name: "Kantin Pusat Menu",         type: "Image", duration: "15s", size: "3 MB",   date: "2026-05-08" },
  { id: "c004", name: "Emergency Evacuation ITS",  type: "Video", duration: "45s", size: "120 MB", date: "2026-04-20" },
  { id: "c005", name: "Research Expo Promo",       type: "Image", duration: "10s", size: "8 MB",   date: "2026-03-15" },
];

/** @type {Readonly<Record<AlertType | "custom", string>>} */
const _AT_ICON = {
  fire:     `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17c-3.3 0-6-2.7-6-6 0-3 2-4.5 3-7 .5 1.5 1 2.5 2 3 0-2 1-4 2-5 0 3 3 4 3 7 .5-.5 1-1.5 1-2.5 1 1.5 1 3.5-1 5 .5 0 1-.5 1.5-1 0 1.5-1 4.5-5.5 6.5z"/></svg>`,
  weather:  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a4 4 0 0 1 7.9-.8A3 3 0 1 1 14 16H5a3 3 0 0 1-2-5z"/><path d="M11.5 16l-1 3M8.5 16l-1 3"/></svg>`,
  security: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L3 5.5v5c0 4 3 7.2 7 8.5 4-1.3 7-4.5 7-8.5v-5z"/><rect x="7.5" y="9" width="5" height="4.5" rx="1"/><path d="M10 9V7.5a1.5 1.5 0 0 1 3 0V9"/></svg>`,
  hazmat:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 2.5 17h15z"/><line x1="10" y1="9" x2="10" y2="12.5"/><circle cx="10" cy="14.5" r="0.75" fill="currentColor" stroke="none"/></svg>`,
  medical:  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="8" width="14" height="4" rx="1"/><rect x="8" y="3" width="4" height="14" rx="1"/></svg>`,
  power:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="11.5 3 7 11.5 11 11.5 8.5 17 13 8.5 9 8.5 11.5 3"/></svg>`,
  custom:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5l3 3-9 9H4.5v-3z"/><line x1="11.5" y1="5.5" x2="14.5" y2="8.5"/></svg>`,
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
window.mount_content_mgmt = function(el) {
  if (_cmRoot && el.querySelector("#cm-root")) {
    _refreshWorkspace();
    _renderActiveAlerts();
    return;
  }
  _cmRoot = el;
  _initCM(el);
};

/** @param {MqttEnvelope} msg */
window.onMsg_content_mgmt = function(msg) {
  if (!_cmRoot) return;
  const p = msg.topic.split("/");
  if (p[0] === "alert")   _renderActiveAlerts();
  if (p[0] === "content") _refreshWorkspace();
};

// ── Init ──────────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
function _initCM(el) {
  _toastEl = document.createElement("div");
  _toastEl.className = "cm-toast";
  document.body.appendChild(_toastEl);

  const root = document.createElement("div");
  root.id = "cm-root";
  root.innerHTML = `
    <div class="cm-tabs">
      <button class="cm-tab active" data-tab="scheduling">Content Scheduling</button>
      <button class="cm-tab"        data-tab="alerts">Emergency Alerts</button>
    </div>
    <div class="cm-body">
      <div id="cm-panel-scheduling" class="cm-panel active"></div>
      <div id="cm-panel-alerts"     class="cm-panel"></div>
    </div>`;
  el.appendChild(root);

  root.querySelectorAll(".cm-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".cm-tab").forEach(b => b.classList.remove("active"));
      root.querySelectorAll(".cm-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      document.getElementById(`cm-panel-${btnEl.dataset.tab}`)?.classList.add("active");
    });
  });

  _buildSchedulingPanel();
  _buildAlertsPanel();
  _loadUploadedLibrary();
}

// ── Scheduling tab ─────────────────────────────────────────────────────────────
/** @type {string} */
let _pendingLibrarySearch = "";
const _debouncedRenderLibrary = debounce(() => _renderLibrary(_pendingLibrarySearch), 150);

/** @returns {void} */
function _buildSchedulingPanel() {
  const panel = document.getElementById("cm-panel-scheduling");
  if (!panel) return;

  panel.innerHTML = `<div class="sched-layout">
    <aside class="sched-lib">
      <div class="lib-header">
        <span class="lib-title">Content Library</span>
        <button class="btn-inline btn-inline-primary" id="lib-upload">Upload New</button>
        <input id="lib-upload-file" type="file" accept="video/mp4,video/webm,video/ogg,image/png,image/jpeg,image/webp,text/html" hidden>
      </div>
      <div class="lib-search-wrap">
        <input class="grid-search" id="lib-search" placeholder="Search library…" autocomplete="off">
      </div>
      <div class="lib-items" id="lib-items"></div>
    </aside>
    <div class="sched-workspace">
      <div class="ws-header">
        <span class="ws-title">Active Assignments</span>
        <button class="btn-inline btn-inline-primary" id="ws-new-btn">New Assignment</button>
      </div>
      <div id="ws-new-form" class="ws-new-form" style="display:none"></div>
      <div id="ws-table-wrap" class="ws-table-wrap"></div>
    </div>
  </div>`;

  _renderLibrary("");
  _refreshWorkspace();

  panel.querySelector("#lib-search")?.addEventListener("input", e => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    _pendingLibrarySearch = target.value.toLowerCase();
    _debouncedRenderLibrary();
  });
  panel.querySelector("#lib-upload")?.addEventListener("click", () => {
    const input = document.getElementById("lib-upload-file");
    if (input instanceof HTMLInputElement) input.click();
  });
  panel.querySelector("#lib-upload-file")?.addEventListener("change", e => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    if (file) _uploadMedia(file);
    input.value = "";
  });
  panel.querySelector("#ws-new-btn")?.addEventListener("click", () => {
    _showAssign = !_showAssign;
    _renderAssignForm(_showAssign);
    const btn = document.getElementById("ws-new-btn");
    if (btn) btn.textContent = _showAssign ? "Cancel" : "New Assignment";
  });
}

/**
 * @param {string} q
 * @returns {void}
 */
function _renderLibrary(q) {
  const el = document.getElementById("lib-items");
  if (!el) return;

  const items = q
    ? _LIB.filter(c => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q))
    : _LIB;

  if (!items.length) {
    el.innerHTML = `<div class="lib-empty">No content found.</div>`;
    return;
  }

  el.innerHTML = items.map(c => `
    <div class="cl-item ${_selContent === c.id ? "selected" : ""}" data-cid="${_esc(c.id)}">
      <div class="cl-thumb">${_thumb(c)}</div>
      <div class="cl-info">
        <div class="cl-name">${_esc(c.name)}</div>
        <div class="cl-meta">
          <span class="ctype-badge">${_esc(c.type)}</span>
          <span class="t-ts">${_esc(c.duration)}</span>
          <span class="t-ts">${_esc(c.size)}</span>
        </div>
      </div>
    </div>`).join("");

  el.querySelectorAll(".cl-item").forEach(item => {
    item.addEventListener("click", () => {
      const itemEl = /** @type {HTMLElement} */ (item);
      _selContent = itemEl.dataset.cid === _selContent ? null : (itemEl.dataset.cid ?? null);
      _renderLibrary(q);
      if (_selContent && !_showAssign) {
        _showAssign = true;
        _renderAssignForm(true);
        const btn = document.getElementById("ws-new-btn");
        if (btn) btn.textContent = "Cancel";
      } else if (_selContent && _showAssign) {
        _renderAssignForm(true);
      }
    });
  });
}

/** @returns {void} */
function _refreshWorkspace() {
  const el = document.getElementById("ws-table-wrap");
  if (!el) return;

  const entries = Object.entries(state.contentSchedules);
  if (!entries.length) {
    el.innerHTML = `<div class="ws-empty">No active content assignments.<br>
      <span class="t-ts">Use "New Assignment" to schedule content to a zone or display.</span></div>`;
    return;
  }

  el.innerHTML = `<table class="assign-table">
    <thead><tr>
      <th>Target</th><th>Content</th><th>QoS</th><th>Updated</th><th></th>
    </tr></thead>
    <tbody>${entries.map(([topic, sched]) => {
      const parts   = topic.split("/");
      const target  = parts[1] === "zone" ? `Zone: ${parts[2]}` : `Display: ${parts[2]}`;
      const content = sched?.content || "—";
      const ts      = sched?.timestamp ? _fmtTs(sched.timestamp) : "—";
      return `<tr>
        <td class="t-mono t-small">${_esc(target)}</td>
        <td style="color:var(--text-primary)">${_esc(content)}</td>
        <td><span class="qos-badge">QoS 1</span></td>
        <td class="t-ts">${_esc(ts)}</td>
        <td><button class="btn-inline btn-inline-ghost ws-rm" data-topic="${_esc(topic)}">Remove</button></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;

  el.querySelectorAll(".ws-rm").forEach(btn => {
    btn.addEventListener("click", () => {
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      const topic = /** @type {ContentZoneScheduleTopic | ContentDisplayOverrideTopic} */ (btnEl.dataset.topic);
      if (!topic) return;
      mqttPublish(topic, { content: null, status: "removed" }, 1, false);
      _showToast(`Removed: ${topic}`);
    });
  });
}

/**
 * @param {boolean} show
 * @returns {void}
 */
function _renderAssignForm(show) {
  const wrap = document.getElementById("ws-new-form");
  if (!(wrap instanceof HTMLElement)) return;

  if (!show) { wrap.style.display = "none"; wrap.innerHTML = ""; return; }

  const zoneOpts = Object.entries(ZONES)
    .map(([k, v]) => `<option value="zone/${_esc(k)}">${_esc(v?.label ?? k)}</option>`).join("");
  const dispOpts = DISPLAYS
    .map(d => `<option value="display/${_esc(d.id)}">${_esc(d.name)} (${_esc(d.id)})</option>`).join("");
  const libOpts  = _LIB
    .map(c => `<option value="${_esc(c.id)}" ${_selContent === c.id ? "selected" : ""}>${_esc(c.name)}</option>`).join("");

  wrap.style.display = "block";
  wrap.innerHTML = `<div class="assign-form">
    <div class="assign-form-row">
      <div class="assign-field">
        <label class="assign-label">Content</label>
        <select class="grid-select" id="af-content" style="min-width:180px">${libOpts}</select>
      </div>
      <div class="assign-field">
        <label class="assign-label">Target</label>
        <select class="grid-select" id="af-target" style="min-width:180px">
          <optgroup label="Zones">${zoneOpts}</optgroup>
          <optgroup label="Displays">${dispOpts}</optgroup>
        </select>
      </div>
      <div class="assign-field">
        <label class="assign-label">Priority</label>
        <select class="grid-select" id="af-qos">
          <option value="1">Normal (QoS 1)</option>
          <option value="2">Critical (QoS 2)</option>
        </select>
      </div>
      <div class="assign-field">
        <label class="assign-label">Retain</label>
        <div class="assign-toggle">
          <input type="checkbox" id="af-retain" checked>
          <label for="af-retain" style="cursor:pointer">On</label>
        </div>
      </div>
    </div>
    <div class="assign-form-actions">
      <button class="btn-inline btn-inline-primary" id="af-pub">Publish</button>
    </div>
  </div>`;

  wrap.querySelector("#af-pub")?.addEventListener("click", () => {
    const contentEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-content"));
    const targetEl  = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-target"));
    const qosEl     = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-qos"));
    const retainEl  = /** @type {HTMLInputElement | null} */ (document.getElementById("af-retain"));
    const contentId = contentEl?.value;
    const target    = targetEl?.value;
    /** @type {MqttQos} */
    const qos       = /** @type {MqttQos} */ (parseInt(qosEl?.value || "1", 10));
    const retain    = retainEl?.checked ?? true;
    if (!contentId || !target) return;

      const content = _LIB.find(c => c.id === contentId);
    const topic   = _assignmentTopic(target);
    if (!topic) {
      _showToast("Invalid assignment target.");
      return;
    }
    mqttPublish(topic, {
      content: content?.name || contentId,
      ...(content?.url ? { media_url: content.url } : {}),
      ...(content?.type ? { media_type: /** @type {import("../../types/protocol").ContentMediaType} */ (content.type.toLowerCase()) } : {}),
      ...(content?.filename ? { filename: content.filename } : {}),
    }, qos, retain);
    _showToast(`Published to ${topic} (QoS ${qos})`);

    _showAssign = false;
    _selContent = null;
    _renderAssignForm(false);
    _renderLibrary("");
    const btn = document.getElementById("ws-new-btn");
    if (btn) btn.textContent = "New Assignment";
  });
}

function _loadUploadedLibrary() {
  fetch("/api/content/library")
    .then(r => r.ok ? r.json() : [])
    .then(items => {
      if (!Array.isArray(items) || !items.length) return;
      const known = new Set(_LIB.map(x => x.id));
      _LIB = [...items.filter(x => x && !known.has(x.id)), ..._LIB];
      _renderLibrary(_pendingLibrarySearch);
    })
    .catch(() => {});
}

/** @param {File} file */
function _uploadMedia(file) {
  const data = new FormData();
  data.append("file", file);
  _showToast(`Uploading ${file.name}...`);
  fetch("/api/content/upload", { method: "POST", body: data })
    .then(async r => {
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload.error || "Upload failed.");
      return /** @type {ContentLibraryItem} */ (payload);
    })
    .then(item => {
      _LIB = [item, ..._LIB.filter(x => x.id !== item.id)];
      _selContent = item.id;
      _renderLibrary(_pendingLibrarySearch);
      _showToast(`Uploaded ${item.name}. Ready to assign.`);
      if (!_showAssign) {
        _showAssign = true;
        _renderAssignForm(true);
      }
    })
    .catch(err => _showToast(err instanceof Error ? err.message : "Upload failed."));
}

/** @param {ContentLibraryItem} item */
function _thumb(item) {
  if (item.type === "Video" && item.url) return `<video src="${_esc(item.url)}" muted playsinline preload="metadata"></video>`;
  if (item.type === "Image" && item.url) return `<img src="${_esc(item.url)}" alt="">`;
  return `<span class="ctype-badge">${_esc(item.type.slice(0, 3))}</span>`;
}

/**
 * @param {string} target
 * @returns {ContentZoneScheduleTopic | ContentDisplayOverrideTopic | null}
 */
function _assignmentTopic(target) {
  const [kind, id] = target.split("/");
  if (!id) return null;
  if (kind === "display") return /** @type {ContentDisplayOverrideTopic} */ (`content/display/${id}/override`);
  if (kind === "zone") return /** @type {ContentZoneScheduleTopic} */ (`content/zone/${id}/schedule`);
  return null;
}

// ── Emergency Alerts tab ──────────────────────────────────────────────────────

/** @returns {void} */
function _buildAlertsPanel() {
  const panel = document.getElementById("cm-panel-alerts");
  if (!panel) return;

  /** @type {BuildingId[]} */
  const buildings = /** @type {BuildingId[]} */ ([...new Set(DISPLAYS.map(d => d.building))]);
  const bOpts = buildings.map(b => `<option value="${_esc(b)}">${_esc(b)}</option>`).join("");

  panel.innerHTML = `<div class="alerts-layout">
    <div class="alert-form-col">

      <div class="af-section">
        <div class="section-heading">Alert Type</div>
        <div class="at-grid" id="at-grid">
          ${ALERT_TYPES.map(t => `
            <button class="at-btn" data-aid="${_esc(t.id)}">
              <span class="at-icon">${_AT_ICON[t.id] || _AT_ICON.custom}</span>
              <span class="at-label">${_esc(t.label)}</span>
            </button>`).join("")}
        </div>
      </div>

      <div class="af-section" id="af-details">
        <div class="section-heading" style="margin-bottom:14px">Alert Configuration</div>
        <div class="af-row">
          <div class="assign-field">
            <label class="assign-label">Scope</label>
            <select class="grid-select" id="af-scope-type">
              <option value="network">Entire Network</option>
              <option value="building">Specific Building</option>
              <option value="zone">Specific Zone</option>
              <option value="display">Specific Display</option>
            </select>
          </div>
          <div class="assign-field" id="af-scope-val-wrap" style="display:none">
            <label class="assign-label" id="af-scope-label">Building</label>
            <select class="grid-select" id="af-scope-val">${bOpts}</select>
          </div>
          <div class="assign-field">
            <label class="assign-label">Severity</label>
            <select class="grid-select" id="af-severity">
              <option value="critical">Critical</option>
              <option value="urgent">Urgent</option>
              <option value="advisory">Advisory</option>
            </select>
          </div>
          <div class="assign-field">
            <label class="assign-label">Auto-clear</label>
            <select class="grid-select" id="af-expiry">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="0">Manual only</option>
            </select>
          </div>
        </div>
        <div class="assign-field">
          <label class="assign-label">Message</label>
          <textarea class="af-textarea" id="af-message" placeholder="Alert message…"></textarea>
        </div>
        <div class="af-qos-note">This alert will be delivered with guaranteed exactly-once delivery (QoS 2).</div>
        <button class="btn-issue" id="af-issue">ISSUE ALERT</button>
      </div>

      <div class="af-section">
        <div class="section-heading">Active Alerts</div>
        <div id="aa-list" style="margin-top:12px"></div>
      </div>

      <div class="af-section">
        <button class="history-toggle" id="history-toggle">Show Alert History ↓</button>
        <div id="ah-list" class="ah-table-wrap" style="display:none"></div>
      </div>

    </div>
  </div>`;

  _bindAlertTypeGrid(panel, buildings);
  _bindAlertForm(panel, buildings);
  _renderActiveAlerts();

  panel.querySelector("#history-toggle")?.addEventListener("click", () => {
    _showHistory = !_showHistory;
    const btn  = document.getElementById("history-toggle");
    const list = document.getElementById("ah-list");
    if (list instanceof HTMLElement) list.style.display = _showHistory ? "block" : "none";
    if (btn)  btn.textContent = _showHistory ? "Hide Alert History ↑" : "Show Alert History ↓";
    if (_showHistory) _renderAlertHistory();
  });
}

/**
 * @param {HTMLElement} panel
 * @param {BuildingId[]} _buildings
 * @returns {void}
 */
function _bindAlertTypeGrid(panel, _buildings) {
  panel.querySelectorAll(".at-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".at-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      _selAlertType = /** @type {AlertType | null} */ (btnEl.dataset.aid ?? null);

      const details = document.getElementById("af-details");
      if (details instanceof HTMLElement) details.style.display = "block";

      const type  = ALERT_TYPES.find(t => t.id === _selAlertType);
      const msgEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("af-message"));
      if (msgEl && type && !msgEl.value) msgEl.value = type.defaultMsg;
    });
  });
}

/**
 * @param {HTMLElement} _panel
 * @param {BuildingId[]} buildings
 * @returns {void}
 */
function _bindAlertForm(_panel, buildings) {
  const scopeType    = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-scope-type"));
  const scopeValWrap = document.getElementById("af-scope-val-wrap");
  const scopeLabel   = document.getElementById("af-scope-label");
  const scopeVal     = document.getElementById("af-scope-val");

  scopeType?.addEventListener("change", () => {
    /** @type {AlertScope} */
    const v = /** @type {AlertScope} */ (scopeType.value);
    if (v === "network") {
      if (scopeValWrap instanceof HTMLElement) scopeValWrap.style.display = "none";
      return;
    }
    if (scopeValWrap instanceof HTMLElement) scopeValWrap.style.display = "block";
    /** @type {Record<string, string>} */
    const labelMap = { building: "Building", zone: "Zone", display: "Display" };
    if (scopeLabel)   scopeLabel.textContent = labelMap[v] || v;

    const zones    = Object.keys(ZONES);
    const displays = DISPLAYS;
    const opts = v === "building" ? buildings.map(b => `<option value="${_esc(b)}">${_esc(b)}</option>`).join("")
               : v === "zone"     ? zones.map(z => `<option value="${_esc(z)}">${_esc(ZONES[/** @type {ZoneId} */ (z)]?.label ?? z)}</option>`).join("")
               :                    displays.map(d => `<option value="${_esc(d.id)}">${_esc(d.name)} (${_esc(d.id)})</option>`).join("");
    if (scopeVal) scopeVal.innerHTML = opts;
  });

  document.getElementById("af-issue")?.addEventListener("click", _onIssueAlert);
}

/** @returns {void} */
function _onIssueAlert() {
  if (!_selAlertType) return;

  const type      = ALERT_TYPES.find(t => t.id === _selAlertType);
  const scopeTypeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-scope-type"));
  const scopeValEl  = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-scope-val"));
  const severityEl  = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-severity"));
  const expiryEl    = /** @type {HTMLSelectElement | null} */ (document.getElementById("af-expiry"));
  const messageEl   = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("af-message"));

  /** @type {AlertScope} */
  const scopeType = /** @type {AlertScope} */ (scopeTypeEl?.value || "network");
  // Replace spaces with underscores — MQTT topic segments must not contain spaces.
  const scopeId   = (scopeType === "network" ? "all" : (scopeValEl?.value || "all")).replace(/\s+/g, "_");
  /** @type {AlertSeverity} */
  const severity  = /** @type {AlertSeverity} */ (severityEl?.value || "critical");
  const expiry    = expiryEl?.value || "60";
  const message   = messageEl?.value?.trim() || type?.defaultMsg || "";

  /** @type {AlertTopic} */
  const topic    = /** @type {AlertTopic} */ (`alert/${scopeType}/${scopeId}/emergency`);
  const affected = _affectedCount(scopeType, scopeId);
  const scopeLabel = scopeType === "network" ? "Entire Network" : `${scopeType}: ${scopeId}`;

  _showConfirm({
    title:       `Issue ${type?.label || _selAlertType} Alert`,
    body:        `<p>Scope: <strong>${_esc(scopeLabel)}</strong></p>
                  <p><strong>${affected}</strong> display${affected !== 1 ? "s" : ""} will be affected.</p>
                  <p class="cm-confirm-warn">All affected displays will immediately switch to emergency mode.</p>`,
    confirmLabel: "ISSUE ALERT",
    confirmCls:   "btn-issue",
    onConfirm: () => {
      if (!_selAlertType) return;
      /** @type {import("../../types/protocol").UnixSeconds | undefined} */
      const expiryTime = expiry === "0"
        ? undefined
        : /** @type {import("../../types/protocol").UnixSeconds} */ (Math.floor((Date.now() + parseInt(expiry, 10) * 60000) / 1000));
      mqttPublish(topic, /** @type {import("../../types/protocol").ActiveAlertPayload} */ ({
        status:     "active",
        message,
        severity,
        alert_type: _selAlertType,
        issuer:     /** @type {import("../../types/protocol").ClientId} */ ("dashboard"),
        ...(expiryTime != null && { expiry_time: expiryTime }),
      }), 2, true);
      _showToast(`Emergency alert issued → ${topic} (QoS 2, retain=true)`);
    },
  });
}

/**
 * @param {AlertScope} scopeType
 * @param {string} scopeId
 * @returns {number}
 */
function _affectedCount(scopeType, scopeId) {
  if (scopeType === "network")  return DISPLAYS.length;
  if (scopeType === "building") return DISPLAYS.filter(d => d.building === scopeId).length;
  if (scopeType === "zone")     return DISPLAYS.filter(d => d.zone === scopeId).length;
  if (scopeType === "display")  return DISPLAYS.some(d => d.id === scopeId) ? 1 : 0;
  return 0;
}

/** @returns {void} */
function _renderActiveAlerts() {
  const el = document.getElementById("aa-list");
  if (!el) return;

  const alerts = Object.entries(state.alerts);
  if (!alerts.length) {
    el.innerHTML = `<div class="aa-empty">No active alerts.</div>`;
    return;
  }

  el.innerHTML = alerts.filter(([, a]) => a != null).map(([topic, alert]) => {
    if (!alert) return "";
    const parts    = topic.split("/");
    /** @type {AlertScope} */
    const scope    = /** @type {AlertScope} */ (parts[1] || "network");
    const id       = parts[2] || "?";
    const alertType = /** @type {AlertType | undefined} */ ("alert_type" in alert ? alert.alert_type : undefined);
    const type     = ALERT_TYPES.find(t => t.id === alertType);
    const affected = _affectedCount(scope, id);
    const icon     = _AT_ICON[alertType ?? "custom"] || _AT_ICON.custom;
    const lbl      = scope === "network" ? "Entire Network" : `${scope}: ${id}`;

    return `<div class="aa-card">
      <div class="aa-card-icon">${icon}</div>
      <div class="aa-card-body">
        <div class="aa-card-title">${_esc(type?.label || alertType || "Alert")}</div>
        <div class="aa-card-scope">${_esc(lbl)}</div>
        <div class="aa-card-msg">${_esc("message" in alert ? alert.message : "—")}</div>
        <div class="aa-card-meta">
          <span class="t-ts">Issued ${_timeAgo(alert.timestamp)}</span>
          <span class="t-ts">${affected} display${affected !== 1 ? "s" : ""} affected</span>
        </div>
      </div>
      <button class="btn-inline btn-inline-amber aa-clear" data-topic="${_esc(topic)}">Clear</button>
    </div>`;
  }).join("");

  el.querySelectorAll(".aa-clear").forEach(btn => {
    btn.addEventListener("click", () => {
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      const topic = /** @type {AlertTopic} */ (btnEl.dataset.topic);
      if (!topic) return;
      _showConfirm({
        title:        "Clear Emergency Alert",
        body:         `<p>Clear the active alert on:</p>
                       <p><strong>${_esc(topic)}</strong></p>
                       <p>All displays will return to scheduled content.</p>`,
        confirmLabel: "Clear Alert",
        confirmCls:   "btn-inline btn-inline-amber",
        onConfirm: () => {
          mqttPublish(topic, { status: "cleared", message: "" }, 2, true);
          _showToast(`Alert cleared → ${topic} (QoS 2)`);
        },
      });
    });
  });
}

/** @returns {void} */
function _renderAlertHistory() {
  const el = document.getElementById("ah-list");
  if (!el) return;

  const cutoff  = Date.now() - 86400000;
  const cleared = state.auditLog.filter(e => {
    if (!e.topic.startsWith("alert/")) return false;
    const payload = /** @type {{ status?: string } | null} */ (e.payload);
    return payload?.status === "cleared" && new Date(e.timestamp).getTime() > cutoff;
  });

  if (!cleared.length) {
    el.innerHTML = `<div class="aa-empty t-ts" style="margin-top:8px">No cleared alerts in the last 24 hours.</div>`;
    return;
  }

  el.innerHTML = `<table class="assign-table" style="margin-top:10px">
    <thead><tr><th>Topic</th><th>Cleared At</th></tr></thead>
    <tbody>${cleared.map(e => `<tr>
      <td class="t-mono t-small">${_esc(e.topic)}</td>
      <td class="t-ts">${_esc(_fmtTs(e.timestamp))}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

// ── Confirmation dialog ────────────────────────────────────────────────────────
/** @type {Element | null} */
let _confirmPrevFocus = null;

/** @param {ConfirmOptions} opts */
function _showConfirm({ title, body, confirmLabel, confirmCls, onConfirm }) {
  _confirm?.remove();
  _confirmPrevFocus = document.activeElement;

  _confirm = document.createElement("div");
  _confirm.className = "cm-confirm-overlay";
  _confirm.setAttribute("role", "alertdialog");
  _confirm.setAttribute("aria-modal", "true");
  _confirm.setAttribute("aria-labelledby", "cc-title");
  _confirm.setAttribute("aria-describedby", "cc-body");
  _confirm.innerHTML = `<div class="cm-confirm-box">
    <div class="cm-confirm-title" id="cc-title">${_esc(title)}</div>
    <div class="cm-confirm-body" id="cc-body">${body}</div>
    <div class="cm-confirm-actions">
      <button class="btn-inline btn-inline-ghost" id="cc-cancel">Cancel</button>
      <button class="${confirmCls || "btn-inline btn-inline-primary"}" id="cc-confirm">${_esc(confirmLabel)}</button>
    </div>
  </div>`;
  document.body.appendChild(_confirm);

  const closeConfirm = () => {
    _confirm?.remove();
    _confirm = null;
    if (_confirmPrevFocus instanceof HTMLElement) _confirmPrevFocus.focus();
    _confirmPrevFocus = null;
  };

  _confirm.querySelector("#cc-cancel")?.addEventListener("click", closeConfirm);
  _confirm.querySelector("#cc-confirm")?.addEventListener("click", () => { closeConfirm(); onConfirm?.(); });
  _confirm.addEventListener("keydown", e => { if (e.key === "Escape") closeConfirm(); });

  const confirmBtn = _confirm.querySelector("#cc-cancel");
  if (confirmBtn instanceof HTMLElement) confirmBtn.focus();
}

// ── Toast ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} msg
 * @returns {void}
 */
function _showToast(msg) {
  if (!_toastEl) return;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastEl.textContent = msg;
  _toastEl.classList.add("visible");
  _toastTimer = setTimeout(() => _toastEl?.classList.remove("visible"), 3500);
}
