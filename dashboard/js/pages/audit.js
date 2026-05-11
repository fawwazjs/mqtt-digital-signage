"use strict";
// @ts-check

/**
 * @typedef {import("../../types/state").AuditLogEntry} AuditLogEntry
 * @typedef {import("../../types/protocol").DisplayId} DisplayId
 * @typedef {import("../../types/protocol").MqttEnvelope} MqttEnvelope
 * @typedef {import("../../types/protocol").MqttQos} MqttQos
 */

/**
 * @typedef {"display" | "alert" | "content" | "analytics" | "maintenance" | "unknown"} TopicType
 * @typedef {"all" | "1h" | "24h" | "7d"} AuditTimeFilter
 */

/**
 * @typedef {object} AuditFilter
 * @property {string[]} types
 * @property {string[]} qos
 * @property {AuditTimeFilter} time
 * @property {string} text
 * @property {DisplayId | null} display
 */

// ── Module state ───────────────────────────────────────────────────────────
/** @type {HTMLElement | null} */
let _aRoot     = null;
/** @type {AuditFilter} */
let _aFilter   = { types: [], qos: [], time: "all", text: "", display: null };
/** @type {number} */
let _aLimit    = 150;
/** @type {boolean} */
let _aLive     = true;
/** @type {IntersectionObserver | null} */
let _aObserver = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _aDebounce = null;

/** @type {readonly TopicType[]} */
const _ALL_TYPES = ["display", "alert", "content", "analytics", "maintenance"];

// ── Lifecycle hooks ────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
window.mount_audit = function(el) {
  if (window._auditPendingDisplay) {
    _aFilter.display = window._auditPendingDisplay;
    window._auditPendingDisplay = null;
    _aLimit = 150;
    if (_aRoot && el.querySelector("#audit-root")) {
      _renderTable();
      _syncControls();
      return;
    }
  }

  if (_aRoot && el.querySelector("#audit-root")) {
    _renderTable();
    return;
  }

  _aRoot = el;
  _initAudit(el);
};

/** @param {MqttEnvelope} _msg */
window.onMsg_audit = function(_msg) {
  if (!_aRoot || !_aLive) return;
  if (_aDebounce) clearTimeout(_aDebounce);
  _aDebounce = setTimeout(_renderTable, 300);
};

// ── Init ───────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
function _initAudit(el) {
  el.innerHTML = `
<div id="audit-root">
  <div class="audit-bar">
    <input class="audit-search" id="au-search" placeholder="Search topic or payload…" autocomplete="off">
    <div class="audit-sep"></div>
    <div class="audit-pill-group" id="au-types">
      ${_ALL_TYPES.map(t => `<button class="audit-pill" data-val="${t}">${t}</button>`).join("")}
    </div>
    <div class="audit-sep"></div>
    <div class="audit-pill-group" id="au-qos">
      <button class="audit-pill audit-pill-qos" data-val="0">Q0</button>
      <button class="audit-pill audit-pill-qos" data-val="1">Q1</button>
      <button class="audit-pill audit-pill-qos" data-val="2">Q2</button>
    </div>
    <div class="audit-sep"></div>
    <select class="audit-select" id="au-time">
      <option value="all">All time</option>
      <option value="1h">Last 1h</option>
      <option value="24h">Last 24h</option>
      <option value="7d">Last 7d</option>
    </select>
    <div id="au-display-chip"></div>
    <span class="audit-count" id="au-count">— entries</span>
    <div class="audit-sep"></div>
    <div class="audit-live-dot" id="au-live-dot" title="Live — click to pause"></div>
    <button class="audit-export-btn" id="au-export-csv">CSV</button>
    <button class="audit-export-btn" id="au-export-json">JSON</button>
  </div>
  <div class="audit-table-wrap" id="au-wrap">
    <table class="audit-table">
      <thead class="audit-thead">
        <tr>
          <th>Time</th><th>Topic</th><th>QoS</th><th>R</th><th>Payload</th><th></th>
        </tr>
      </thead>
      <tbody class="audit-tbody" id="au-tbody"></tbody>
    </table>
    <div class="audit-sentinel" id="au-sentinel"></div>
  </div>
</div>`;

  _bindControls();
  _syncControls();
  _bindRowEvents();
  _renderTable();
  _setupObserver();
}

// ── Controls ───────────────────────────────────────────────────────────────
/** @type {() => void} */
const _debouncedRenderTable = debounce(() => _renderTable(), 150);

/** @returns {void} */
function _bindControls() {
  if (!_aRoot) return;

  _aRoot.querySelector("#au-search")?.addEventListener("input", e => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    _aFilter.text = target.value.trim();
    _aLimit = 150;
    _debouncedRenderTable();
  });

  _aRoot.querySelectorAll("#au-types .audit-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      const v = btnEl.dataset.val ?? "";
      const i = _aFilter.types.indexOf(v);
      if (i >= 0) _aFilter.types.splice(i, 1); else _aFilter.types.push(v);
      btnEl.classList.toggle("active", _aFilter.types.includes(v));
      _aLimit = 150;
      _renderTable();
    });
  });

  _aRoot.querySelectorAll("#au-qos .audit-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      const v = btnEl.dataset.val ?? "";
      const i = _aFilter.qos.indexOf(v);
      if (i >= 0) _aFilter.qos.splice(i, 1); else _aFilter.qos.push(v);
      btnEl.classList.toggle("active", _aFilter.qos.includes(v));
      _aLimit = 150;
      _renderTable();
    });
  });

  _aRoot.querySelector("#au-time")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _aFilter.time = /** @type {AuditTimeFilter} */ (target.value);
    _aLimit = 150;
    _renderTable();
  });

  _aRoot.querySelector("#au-live-dot")?.addEventListener("click", () => {
    _aLive = !_aLive;
    const dot = _aRoot?.querySelector("#au-live-dot");
    if (dot instanceof HTMLElement) {
      dot.classList.toggle("paused", !_aLive);
      dot.title = _aLive ? "Live — click to pause" : "Paused — click to resume";
    }
    if (_aLive) _renderTable();
  });

  _aRoot.querySelector("#au-export-csv")?.addEventListener("click",  _exportCSV);
  _aRoot.querySelector("#au-export-json")?.addEventListener("click", _exportJSON);
}

/** @returns {void} */
function _syncControls() {
  if (!_aRoot) return;

  _aRoot.querySelectorAll("#au-types .audit-pill").forEach(btn => {
    const btnEl = /** @type {HTMLButtonElement} */ (btn);
    btnEl.classList.toggle("active", _aFilter.types.includes(btnEl.dataset.val ?? ""));
  });
  _aRoot.querySelectorAll("#au-qos .audit-pill").forEach(btn => {
    const btnEl = /** @type {HTMLButtonElement} */ (btn);
    btnEl.classList.toggle("active", _aFilter.qos.includes(btnEl.dataset.val ?? ""));
  });

  const timeEl = /** @type {HTMLSelectElement | null} */ (_aRoot.querySelector("#au-time"));
  if (timeEl) timeEl.value = _aFilter.time;

  const searchEl = /** @type {HTMLInputElement | null} */ (_aRoot.querySelector("#au-search"));
  if (searchEl) searchEl.value = _aFilter.text;

  _renderDisplayChip();
}

/** @returns {void} */
function _renderDisplayChip() {
  if (!_aRoot) return;
  const chip = _aRoot.querySelector("#au-display-chip");
  if (!chip) return;
  if (!_aFilter.display) { chip.innerHTML = ""; return; }
  chip.innerHTML = `<div class="audit-display-chip">
    <span>${_esc(_aFilter.display)}</span>
    <button id="au-clear-display" title="Clear">×</button>
  </div>`;
  chip.querySelector("#au-clear-display")?.addEventListener("click", () => {
    _aFilter.display = null;
    _aLimit = 150;
    _renderTable();
    _renderDisplayChip();
  });
}

// ── Row event delegation (bound once, survives innerHTML replacement) ───────

/** @returns {void} */
function _bindRowEvents() {
  if (!_aRoot) return;
  const tbody = _aRoot.querySelector("#au-tbody");
  if (!tbody) return;

  tbody.addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = target.closest(".atr");
    if (!(row instanceof HTMLElement) || !row.dataset.expand) return;
    const expand = document.getElementById(row.dataset.expand);
    if (!expand) return;
    const wasOpen = expand.classList.contains("open");

    tbody.querySelectorAll(".atr.expanded").forEach(r => r.classList.remove("expanded"));
    tbody.querySelectorAll(".atr-expand.open").forEach(r => r.classList.remove("open"));

    if (!wasOpen) {
      row.classList.add("expanded");
      expand.classList.add("open");
    }
  });
}

// ── Load-more sentinel ─────────────────────────────────────────────────────

/** @returns {void} */
function _setupObserver() {
  if (!_aRoot) return;
  const sentinel = _aRoot.querySelector("#au-sentinel");
  const wrap     = _aRoot.querySelector("#au-wrap");
  if (!sentinel || !wrap) return;

  _aObserver = new IntersectionObserver(entries => {
    if (!entries[0]?.isIntersecting) return;
    const all = _filtered();
    if (_aLimit >= all.length) return;
    const oldLimit = _aLimit;
    _aLimit = Math.min(_aLimit + 100, all.length);
    _appendRows(all, oldLimit);
    _updateCount(all.length);
  }, { root: wrap, threshold: 0 });

  _aObserver.observe(sentinel);
}

// ── Filter logic ───────────────────────────────────────────────────────────

/**
 * @param {string} topic
 * @returns {TopicType}
 */
function _topicType(topic) {
  const prefix = topic.split("/")[0];
  if (prefix === "display" || prefix === "alert" || prefix === "content" ||
      prefix === "analytics" || prefix === "maintenance") {
    return prefix;
  }
  return "unknown";
}

/**
 * @param {AuditTimeFilter} time
 * @returns {number}
 */
function _timeMs(time) {
  const now = Date.now();
  if (time === "1h")  return now - 3_600_000;
  if (time === "24h") return now - 86_400_000;
  if (time === "7d")  return now - 604_800_000;
  return 0;
}

/**
 * @param {AuditLogEntry} entry
 * @returns {boolean}
 */
function _passes(entry) {
  const { topic, payload, qos, timestamp } = entry;
  const type = _topicType(topic);

  if (_aFilter.types.length > 0 && !_aFilter.types.includes(type)) return false;
  if (_aFilter.qos.length   > 0 && !_aFilter.qos.includes(String(qos))) return false;

  if (_aFilter.time !== "all") {
    const ts = new Date(timestamp).getTime();
    if (isNaN(ts) || ts < _timeMs(_aFilter.time)) return false;
  }

  if (_aFilter.display && !topic.includes(_aFilter.display)) return false;

  if (_aFilter.text) {
    const needle = _aFilter.text.toLowerCase();
    const pstr   = typeof payload === "object" ? JSON.stringify(payload) : String(payload ?? "");
    if (!topic.toLowerCase().includes(needle) && !pstr.toLowerCase().includes(needle)) return false;
  }

  return true;
}

/** @returns {AuditLogEntry[]} */
function _filtered() { return state.auditLog.filter(_passes); }

// ── Render ─────────────────────────────────────────────────────────────────

/** @returns {void} */
function _renderTable() {
  if (!_aRoot) return;
  const all   = _filtered();
  const tbody = _aRoot.querySelector("#au-tbody");
  if (!tbody) return;

  if (all.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="audit-empty">No entries match current filters.</td></tr>`;
    _updateCount(0);
    return;
  }

  tbody.innerHTML = all.slice(0, _aLimit).map((e, i) => _buildRow(e, i)).join("");
  _updateCount(all.length);
}

/**
 * @param {AuditLogEntry[]} all
 * @param {number} from
 * @returns {void}
 */
function _appendRows(all, from) {
  if (!_aRoot) return;
  const tbody = _aRoot.querySelector("#au-tbody");
  if (!tbody) return;
  const frag = document.createDocumentFragment();
  const tmp  = document.createElement("tbody");
  tmp.innerHTML = all.slice(from, _aLimit).map((e, i) => _buildRow(e, from + i)).join("");
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);
  tbody.appendChild(frag);
}

/**
 * @param {number} total
 * @returns {void}
 */
function _updateCount(total) {
  if (!_aRoot) return;
  const el = _aRoot.querySelector("#au-count");
  if (el) el.textContent = `${total.toLocaleString()} entries`;
}

// ── Row HTML ───────────────────────────────────────────────────────────────

/**
 * @param {string} ts
 * @returns {string}
 */
function _fmtTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  /** @param {number} n */
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * @param {MqttQos} qos
 * @returns {string}
 */
function _qosBadge(qos) {
  const cls = qos === 2 ? " aq-2" : qos === 1 ? " aq-1" : "";
  return `<span class="audit-qos${cls}">Q${qos}</span>`;
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
function _payloadPreview(payload) {
  if (payload == null) return "";
  const s = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
  return _esc(s.length > 100 ? s.slice(0, 100) + "…" : s);
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
function _payloadFull(payload) {
  if (payload == null) return "";
  if (typeof payload !== "object") return _esc(String(payload));
  return _esc(JSON.stringify(payload, null, 2));
}

/**
 * @param {AuditLogEntry} entry
 * @param {number} idx
 * @returns {string}
 */
function _buildRow(entry, idx) {
  const { topic, payload, qos, retained, user_properties, timestamp } = entry;
  const type      = _topicType(topic);
  const topicRest = topic.slice(type.length);
  const retHtml   = retained
    ? '<span class="audit-ret">R</span>'
    : '<span class="audit-ret audit-ret-off">—</span>';

  let upRows = "";
  if (user_properties && typeof user_properties === "object") {
    const keys = Object.keys(user_properties);
    if (keys.length > 0) {
      upRows = keys.map(k =>
        `<div class="aui-row"><span class="aui-key">${_esc(k)}</span><span class="aui-val">${_esc(String(user_properties[k]))}</span></div>`
      ).join("");
    }
  }

  const expandId = `aex-${idx}`;

  return `<tr class="atr" data-expand="${expandId}">
  <td class="atd-ts">${_fmtTime(timestamp)}</td>
  <td class="atd-topic"><span class="atd-type atd-${_esc(type)}">${_esc(type)}</span><span class="atd-path">${_esc(topicRest)}</span></td>
  <td class="atd-qos">${_qosBadge(qos)}</td>
  <td class="atd-ret">${retHtml}</td>
  <td class="atd-preview">${_payloadPreview(payload)}</td>
  <td class="atd-chev"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 1 7 5 3 9"/></svg></td>
</tr>
<tr class="atr-expand" id="${expandId}">
  <td colspan="6">
    <div class="aex-inner">
      <div class="aex-section">
        <div class="aex-label">Topic</div>
        <div class="aex-mono">${_esc(topic)}</div>
      </div>
      <div class="aex-section">
        <div class="aex-label">Payload</div>
        <pre class="aex-payload">${_payloadFull(payload)}</pre>
      </div>
      ${upRows ? `<div class="aex-section"><div class="aex-label">User Properties</div><div class="aex-props">${upRows}</div></div>` : ""}
      <div class="aex-meta">
        <span>QoS ${qos}</span>
        <span>${retained ? "retained" : "not retained"}</span>
        <span>${_esc(String(timestamp ?? ""))}</span>
      </div>
    </div>
  </td>
</tr>`;
}

// ── Export ─────────────────────────────────────────────────────────────────

/** @returns {void} */
function _exportCSV() {
  const header = ["timestamp", "topic", "qos", "retained", "payload", "user_properties"];
  const rows   = _filtered().map(e => [
    e.timestamp ?? "",
    e.topic,
    e.qos,
    e.retained ? "true" : "false",
    typeof e.payload === "object" ? JSON.stringify(e.payload) : String(e.payload ?? ""),
    e.user_properties ? JSON.stringify(e.user_properties) : "",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  _download("audit-log.csv", "text/csv", [header.join(","), ...rows].join("\r\n"));
}

/** @returns {void} */
function _exportJSON() {
  _download("audit-log.json", "application/json", JSON.stringify(_filtered(), null, 2));
}

/**
 * @param {string} filename
 * @param {string} mime
 * @param {string} content
 * @returns {void}
 */
function _download(filename, mime, content) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
