"use strict";
// @ts-check

/**
 * @typedef {import("../../types/state").DashboardNotification} DashboardNotification
 * @typedef {import("../../types/state").NotificationId} NotificationId
 * @typedef {import("../../types/state").NotificationSeverity} NotificationSeverity
 * @typedef {import("../../types/state").NotificationType} NotificationType
 * @typedef {import("../../types/protocol").MqttEnvelope} MqttEnvelope
 */

/**
 * @typedef {object} NotificationMeta
 * @property {string} title
 * @property {string} desc
 */

/**
 * @typedef {"all" | NotificationSeverity} SeverityFilter
 * @typedef {"all" | NotificationType} TypeFilter
 * @typedef {"1h" | "6h" | "24h" | "7d" | "all"} TimeFilter
 */

/**
 * @typedef {object} NotifFilter
 * @property {SeverityFilter} severity
 * @property {TypeFilter} type
 * @property {TimeFilter} time
 * @property {string} search
 */

// ── Module state ──────────────────────────────────────────────────────────────
/** @type {HTMLElement | null} */
let _nRoot       = null;
/** @type {NotificationId | null} */
let _lastNotifId = null;
/** @type {boolean} */
let _scrolledDown = false;
/** @type {number} */
let _newCount    = 0;
/** @type {boolean} */
let _muted       = true;
/** @type {HTMLElement | null} */
let _nConfirm    = null;

/** @type {NotifFilter} */
const _nFilter = {
  severity: /** @type {SeverityFilter} */ ("all"),
  type:     /** @type {TypeFilter} */ ("all"),
  time:     /** @type {TimeFilter} */ ("24h"),
  search:   "",
};

// ── Icons ─────────────────────────────────────────────────────────────────────
/** @type {Readonly<Record<NotificationType, string>>} */
const _NICON = {
  display_offline:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M7 17h6M10 14v3"/><line x1="6" y1="6" x2="14" y2="12"/><line x1="14" y1="6" x2="6" y2="12"/></svg>`,
  display_online:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M7 17h6M10 14v3"/><polyline points="6 9 8.5 11.5 14 7"/></svg>`,
  maintenance_alert: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5a3 3 0 0 0-4.2 4.2L4 16l.7.7L12 9.3a3 3 0 0 0 3.5-4.8z"/><circle cx="4.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  alert_issued:      `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 2.5 17h15z"/><line x1="10" y1="9" x2="10" y2="12.5"/><circle cx="10" cy="14.5" r="0.75" fill="currentColor" stroke="none"/></svg>`,
  alert_cleared:     `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><polyline points="6.5 10 9 12.5 13.5 8"/></svg>`,
};
/** @type {string} */
const _NICON_DEFAULT = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="7.5"/><line x1="10" y1="7" x2="10" y2="11"/><circle cx="10" cy="13.5" r="0.75" fill="currentColor" stroke="none"/></svg>`;

// ── Notification metadata ─────────────────────────────────────────────────────

/**
 * @param {DashboardNotification} n
 * @returns {NotificationMeta}
 */
function _meta(n) {
  switch (n.type) {
    case "display_offline":
      return { title: `Display ${n.ref} went offline`,     desc: "LWT triggered — display is dark. Check power and network." };
    case "display_online":
      return { title: `Display ${n.ref} back online`,      desc: "Display reconnected and reporting health." };
    case "maintenance_alert":
      return { title: `Maintenance alert — ${n.ref}`,      desc: "Display flagged for maintenance intervention." };
    case "alert_issued":
      return { title: "Emergency alert issued",            desc: String(n.ref) };
    case "alert_cleared":
      return { title: "Emergency alert cleared",           desc: String(n.ref) };
    default:
      return { title: n.type || "System event",            desc: String(n.ref || "") };
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
window.mount_notifications = function(el) {
  if (_nRoot && el.querySelector("#nf-root")) {
    _renderFeed();
    return;
  }
  _nRoot = el;
  _lastNotifId = state.notifications[0]?.id ?? null;
  _initNotif(el);
};

/** @param {MqttEnvelope} _msg */
window.onMsg_notifications = function(_msg) {
  if (!_nRoot) return;
  const latest = state.notifications[0];
  if (!latest || latest.id === _lastNotifId) return;
  _lastNotifId = latest.id;

  if (!_passes(latest)) return;

  _prependRow(latest);

  if (!_muted && latest.severity === "critical") _beep();

  if (_scrolledDown) {
    _newCount++;
    _showPill();
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
function _initNotif(el) {
  const root = document.createElement("div");
  root.id = "nf-root";
  root.innerHTML = `
    <div class="nf-controls">
      <input class="grid-search" id="nf-search" placeholder="Search notifications…" autocomplete="off" style="width:180px">
      <select class="grid-select" id="nf-sev">
        <option value="all">All Severity</option>
        <option value="critical">Critical</option>
        <option value="warn">Warning</option>
        <option value="info">Info</option>
      </select>
      <select class="grid-select" id="nf-type">
        <option value="all">All Types</option>
        <option value="display_offline">Display Offline</option>
        <option value="display_online">Display Online</option>
        <option value="maintenance_alert">Maintenance</option>
        <option value="alert_issued">Alert Issued</option>
        <option value="alert_cleared">Alert Cleared</option>
      </select>
      <select class="grid-select" id="nf-time">
        <option value="1h">Last hour</option>
        <option value="6h">Last 6 hours</option>
        <option value="24h" selected>Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="all">All time</option>
      </select>
      <div class="nf-controls-right">
        <button class="nf-sound-btn" id="nf-sound" title="Sound: muted (click to enable)">
          ${_svgMuted()}
        </button>
        <button class="btn-inline btn-inline-ghost" id="nf-mark-read">Mark all read</button>
        <button class="btn-inline btn-inline-ghost" id="nf-clear-all">Clear all</button>
      </div>
    </div>
    <div class="nf-feed-wrap">
      <div id="nf-new-pill">↑ New notifications</div>
      <div id="nf-feed"></div>
    </div>`;
  el.appendChild(root);

  _bindControls(root);
  _renderFeed();
}

/** @type {() => void} */
const _debouncedRenderFeed = debounce(() => _renderFeed(), 150);

/** @param {HTMLElement} root */
function _bindControls(root) {
  root.querySelector("#nf-search")?.addEventListener("input", e => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    _nFilter.search = target.value.toLowerCase();
    _debouncedRenderFeed();
  });
  root.querySelector("#nf-sev")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _nFilter.severity = /** @type {SeverityFilter} */ (target.value);
    _renderFeed();
  });
  root.querySelector("#nf-type")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _nFilter.type = /** @type {TypeFilter} */ (target.value);
    _renderFeed();
  });
  root.querySelector("#nf-time")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _nFilter.time = /** @type {TimeFilter} */ (target.value);
    _renderFeed();
  });

  root.querySelector("#nf-mark-read")?.addEventListener("click", () => {
    state.notifications.forEach(n => { n.read = true; });
    state.unreadCritical = 0;
    _updateBadge(0, "warn");
    _renderFeed();
  });

  root.querySelector("#nf-clear-all")?.addEventListener("click", () => {
    _nShowConfirm(
      "Clear All Notifications",
      `<p>Remove all <strong>${state.notifications.length}</strong> notifications?</p>`,
      "Clear All",
      () => {
        state.notifications.length = 0;
        state.unreadCritical = 0;
        _updateBadge(0, "warn");
        _lastNotifId = null;
        _renderFeed();
      }
    );
  });

  root.querySelector("#nf-sound")?.addEventListener("click", () => {
    _muted = !_muted;
    const btn = root.querySelector("#nf-sound");
    if (!btn) return;
    btn.innerHTML   = _muted ? _svgMuted() : _svgUnmuted();
    btn.classList.toggle("unmuted", !_muted);
    if (btn instanceof HTMLElement) {
      btn.title = _muted ? "Sound: muted (click to enable)" : "Sound: on (click to mute)";
    }
  });

  const feed = root.querySelector("#nf-feed");
  if (feed instanceof HTMLElement) {
    feed.addEventListener("scroll", () => {
      const wasDown = _scrolledDown;
      _scrolledDown = (feed.scrollTop > 80);
      if (wasDown && !_scrolledDown) {
        _newCount = 0;
        _hidePill();
      }
    }, { passive: true });
  }

  root.querySelector("#nf-new-pill")?.addEventListener("click", () => {
    if (feed instanceof HTMLElement) {
      feed.scrollTo({ top: 0, behavior: "smooth" });
    }
    _newCount = 0;
    _hidePill();
  });
}

// ── Feed render ───────────────────────────────────────────────────────────────

/** @returns {void} */
function _renderFeed() {
  const feed = document.getElementById("nf-feed");
  if (!feed) return;

  const list = _filteredNotifs();
  if (!list.length) {
    feed.innerHTML = `<div class="nf-empty">No notifications match current filters.</div>`;
    return;
  }

  feed.innerHTML = list.map(_buildRow).join("");
  feed.querySelectorAll(".nf-item").forEach(el => _bindRow(/** @type {HTMLElement} */ (el)));
}

/** @returns {DashboardNotification[]} */
function _filteredNotifs() {
  /** @type {DashboardNotification[]} */
  let list = [...state.notifications];

  if (_nFilter.severity !== "all") list = list.filter(n => n.severity === _nFilter.severity);
  if (_nFilter.type     !== "all") list = list.filter(n => n.type     === _nFilter.type);

  if (_nFilter.time !== "all") {
    /** @type {Record<TimeFilter, number>} */
    const hours = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "all": 0 };
    const h = hours[_nFilter.time];
    if (h) {
      const cutoff = Date.now() - h * 3600000;
      list = list.filter(n => new Date(n.timestamp).getTime() > cutoff);
    }
  }

  if (_nFilter.search) {
    const q = _nFilter.search;
    list = list.filter(n =>
      (n.type || "").toLowerCase().includes(q) ||
      String(n.ref || "").toLowerCase().includes(q)
    );
  }

  return list;
}

/**
 * @param {DashboardNotification} n
 * @returns {boolean}
 */
function _passes(n) {
  if (_nFilter.severity !== "all" && n.severity !== _nFilter.severity) return false;
  if (_nFilter.type     !== "all" && n.type     !== _nFilter.type)     return false;
  if (_nFilter.time !== "all") {
    /** @type {Record<TimeFilter, number>} */
    const hours = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "all": 0 };
    const h = hours[_nFilter.time];
    if (h && new Date(n.timestamp).getTime() < Date.now() - h * 3600000) return false;
  }
  if (_nFilter.search) {
    const q = _nFilter.search;
    if (!(n.type || "").toLowerCase().includes(q) && !String(n.ref || "").toLowerCase().includes(q)) return false;
  }
  return true;
}

// ── Row build + bind ──────────────────────────────────────────────────────────

/**
 * @param {DashboardNotification} n
 * @returns {string}
 */
function _buildRow(n) {
  const m    = _meta(n);
  const icon = _NICON[n.type] || _NICON_DEFAULT;
  const ts   = _fmtTs(n.timestamp);
  /** @type {NotificationType[]} */
  const displayTypes = ["display_offline", "display_online", "maintenance_alert"];
  const isDisplay = displayTypes.includes(n.type);

  return `<div class="nf-item sev-${n.severity || "info"} ${n.read ? "" : "unread"}" data-id="${_esc(n.id)}">
    <div class="nf-main">
      <div class="nf-ts">${_esc(ts)}</div>
      <div class="nf-icon">${icon}</div>
      <div class="nf-body">
        <div class="nf-title">${_esc(m.title)}</div>
        <div class="nf-desc">${_esc(m.desc)}</div>
      </div>
      ${n.read ? "" : `<div class="nf-dot"></div>`}
      <svg class="nf-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <polyline points="4 2 8 6 4 10"/>
      </svg>
    </div>
    <div class="nf-expand">
      <div class="nf-expand-inner">
        <div class="nf-expand-row">
          <span class="nf-expand-key">type</span>
          <span class="nf-expand-val">${_esc(n.type || "—")}</span>
        </div>
        <div class="nf-expand-row">
          <span class="nf-expand-key">ref</span>
          <span class="nf-expand-val">${_esc(String(n.ref || "—"))}</span>
        </div>
        <div class="nf-expand-row">
          <span class="nf-expand-key">time</span>
          <span class="nf-expand-val">${_esc(n.timestamp || "—")}</span>
        </div>
        ${isDisplay
          ? `<button class="nf-link-btn">View on Map →</button>`
          : ""}
      </div>
    </div>
  </div>`;
}

/**
 * @param {HTMLElement} row
 * @returns {void}
 */
function _bindRow(row) {
  row.addEventListener("click", () => {
    row.classList.toggle("expanded");
    const id = /** @type {NotificationId} */ (row.dataset.id);
    const n  = state.notifications.find(x => x.id === id);
    if (n && !n.read) {
      n.read = true;
      row.classList.remove("unread");
      row.querySelector(".nf-dot")?.remove();
      _syncBadge();
    }
  });

  row.querySelector(".nf-link-btn")?.addEventListener("click", e => {
    e.stopPropagation();
    navigateTo("map");
  });
}

/**
 * @param {DashboardNotification} n
 * @returns {void}
 */
function _prependRow(n) {
  const feed = document.getElementById("nf-feed");
  if (!feed) return;

  const empty = feed.querySelector(".nf-empty");
  if (empty) empty.remove();

  const tmp = document.createElement("div");
  tmp.innerHTML = _buildRow(n);
  const row = tmp.firstElementChild;
  if (!(row instanceof HTMLElement)) return;

  row.style.opacity   = "0";
  row.style.transform = "translateY(-14px)";
  feed.insertBefore(row, feed.firstChild);

  requestAnimationFrame(() => {
    row.style.transition = "opacity 300ms ease, transform 300ms ease";
    row.style.opacity    = "1";
    row.style.transform  = "translateY(0)";
  });

  _bindRow(row);
}

/** @returns {void} */
function _syncBadge() {
  const unread   = state.notifications.filter(n => !n.read);
  const critical = unread.filter(n => n.severity === "critical").length;
  const warn     = unread.filter(n => n.severity === "warn").length;
  state.unreadCritical = critical;
  _updateBadge(critical + warn, critical > 0 ? "critical" : "warn");
}

// ── "New notifications" pill ──────────────────────────────────────────────────

/** @returns {void} */
function _showPill() {
  const pill = document.getElementById("nf-new-pill");
  if (!(pill instanceof HTMLElement)) return;
  pill.textContent = `↑ ${_newCount} new notification${_newCount !== 1 ? "s" : ""}`;
  pill.style.display = "block";
}

/** @returns {void} */
function _hidePill() {
  const pill = document.getElementById("nf-new-pill");
  if (pill instanceof HTMLElement) pill.style.display = "none";
}

// ── Sound ─────────────────────────────────────────────────────────────────────

/** @returns {void} */
function _beep() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
    ctx.close();
  } catch (_e) { /* AudioContext may be blocked */ }
}

/** @returns {string} */
function _svgMuted() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="3 7 7 7 12 3 12 17 7 13 3 13"/>
    <line x1="15" y1="8" x2="19" y2="12"/><line x1="19" y1="8" x2="15" y2="12"/>
  </svg>`;
}

/** @returns {string} */
function _svgUnmuted() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="3 7 7 7 12 3 12 17 7 13 3 13"/>
    <path d="M15 7a4 4 0 0 1 0 6"/><path d="M17 5a7 7 0 0 1 0 10"/>
  </svg>`;
}

// ── Confirmation dialog (local, reuses content.css overlay classes) ────────────

/**
 * @param {string} title
 * @param {string} body
 * @param {string} confirmLabel
 * @param {() => void} onConfirm
 * @returns {void}
 */
function _nShowConfirm(title, body, confirmLabel, onConfirm) {
  _nConfirm?.remove();
  _nConfirm = document.createElement("div");
  _nConfirm.className = "cm-confirm-overlay";
  _nConfirm.innerHTML = `<div class="cm-confirm-box">
    <div class="cm-confirm-title">${_esc(title)}</div>
    <div class="cm-confirm-body">${body}</div>
    <div class="cm-confirm-actions">
      <button class="btn-inline btn-inline-ghost" id="nc-cancel">Cancel</button>
      <button class="btn-inline btn-inline-amber" id="nc-confirm">${_esc(confirmLabel)}</button>
    </div>
  </div>`;
  document.body.appendChild(_nConfirm);
  _nConfirm.querySelector("#nc-cancel")?.addEventListener("click",  () => { _nConfirm?.remove(); _nConfirm = null; });
  _nConfirm.querySelector("#nc-confirm")?.addEventListener("click", () => { _nConfirm?.remove(); _nConfirm = null; onConfirm?.(); });
}
