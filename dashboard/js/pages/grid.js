"use strict";
// @ts-check

/**
 * @typedef {import("../../types/state").DisplayConfig} DisplayConfig
 * @typedef {import("../../types/state").DisplayState} DisplayState
 * @typedef {import("../../types/protocol").AlertTopic} AlertTopic
 * @typedef {import("../../types/protocol").DisplayId} DisplayId
 * @typedef {import("../../types/protocol").MqttEnvelope} MqttEnvelope
 * @typedef {import("../../types/protocol").ZoneId} ZoneId
 * @typedef {"online" | "offline" | "loading" | "degraded" | "emergency"} MapStatus
 * @typedef {"all" | MapStatus} StatusFilter
 * @typedef {"name" | "zone" | "status" | "updated"} SortKey
 * @typedef {"compact" | "normal" | "large"} DensityMode
 */

/**
 * @typedef {object} GridFilter
 * @property {ZoneId | "all"} zone
 * @property {StatusFilter} status
 * @property {SortKey} sort
 * @property {DensityMode} density
 * @property {string} search
 */

// ── Module state ──────────────────────────────────────────────────────────────
/** @type {HTMLElement | null} */
let _gRoot    = null;
/** @type {HTMLElement | null} */
let _gWall    = null;
/** @type {HTMLElement | null} */
let _gPanel   = null;
/** @type {DisplayId | null} */
let _gPanelId = null;
/** @type {HTMLElement | null} */
let _gModal   = null;
/** @type {Element | null} */
let _gPrevFocus = null;

/** @type {GridFilter} */
const _gFilter = {
  zone:    /** @type {"all"} */ ("all"),
  status:  /** @type {"all"} */ ("all"),
  sort:    /** @type {SortKey} */ ("name"),
  density: /** @type {DensityMode} */ ("normal"),
  search:  "",
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
window.mount_grid = function(el) {
  if (_gRoot && el.querySelector("#grid-root")) {
    _renderWall();
    return;
  }
  _gRoot = el;
  _initGrid(el);
};

/** @param {MqttEnvelope} msg */
window.onMsg_grid = function(msg) {
  if (!_gWall) return;
  const parts = msg.topic.split("/");

  if (parts[0] === "display") {
    const id = /** @type {DisplayId} */ (parts[1]);
    _updateCell(id);
    if (_gPanelId === id) _refreshGPanel(id);
  } else if (parts[0] === "alert" || parts[0] === "content") {
    _renderWall();
    if (_gPanelId) _refreshGPanel(_gPanelId);
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────

/** @param {HTMLElement} el */
function _initGrid(el) {
  const root = document.createElement("div");
  root.id = "grid-root";
  root.innerHTML = _buildControlsHTML();
  el.appendChild(root);

  _gWall = root.querySelector("#grid-wall");
  _bindControls(root);
  _renderWall();

  _gPanel = document.createElement("div");
  _gPanel.className = "map-panel";
  el.appendChild(_gPanel);

  if (!_gModal) {
    _gModal = document.createElement("div");
    _gModal.className = "grid-modal";
    _gModal.setAttribute("role", "dialog");
    _gModal.setAttribute("aria-modal", "true");
    _gModal.setAttribute("aria-label", "Display fullscreen view");
    _gModal.innerHTML = `
      <div class="grid-modal-bg"></div>
      <div class="grid-modal-inner">
        <button class="grid-modal-close" id="gm-close" aria-label="Close fullscreen view">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
          </svg>
        </button>
        <div class="grid-modal-preview" id="gm-preview"></div>
        <div class="grid-modal-info"    id="gm-info"></div>
      </div>`;
    document.body.appendChild(_gModal);
    _gModal.querySelector(".grid-modal-bg")?.addEventListener("click", _closeModal);
    _gModal.querySelector("#gm-close")?.addEventListener("click", _closeModal);
    _gModal.addEventListener("keydown", _trapModalFocus);
  }

  document.addEventListener("keydown", _onGKeydown);
}

/** @param {KeyboardEvent} e */
function _onGKeydown(e) {
  if (e.key !== "Escape") return;
  if (_gModal && _gModal.classList.contains("open")) _closeModal();
  else _closeGPanel();
}

// ── Controls ──────────────────────────────────────────────────────────────────
/** @type {() => void} */
const _debouncedRenderWall = debounce(() => _renderWall(), 150);

/** @returns {string} */
function _buildControlsHTML() {
  const zoneOpts = Object.entries(ZONES)
    .map(([k, v]) => `<option value="${_esc(k)}">${_esc(v?.label ?? k)}</option>`)
    .join("");

  return `<div class="grid-controls">
    <input  class="grid-search" id="gc-search" placeholder="Search displays…" autocomplete="off">
    <select class="grid-select" id="gc-zone">
      <option value="all">All Zones</option>${zoneOpts}
    </select>
    <select class="grid-select" id="gc-status">
      <option value="all">All Status</option>
      <option value="online">Online</option>
      <option value="offline">Offline</option>
      <option value="degraded">Degraded</option>
      <option value="loading">Loading</option>
      <option value="emergency">Emergency</option>
    </select>
    <select class="grid-select" id="gc-sort">
      <option value="name">Sort: Name</option>
      <option value="zone">Sort: Zone</option>
      <option value="status">Sort: Status</option>
      <option value="updated">Sort: Last Updated</option>
    </select>
    <div class="grid-density" id="gc-density">
      <button class="density-btn"        data-d="compact">Compact</button>
      <button class="density-btn active" data-d="normal">Normal</button>
      <button class="density-btn"        data-d="large">Large</button>
    </div>
  </div>
  <div class="grid-wall grid-wall--normal" id="grid-wall"></div>`;
}

/** @param {HTMLElement} root */
function _bindControls(root) {
  root.querySelector("#gc-search")?.addEventListener("input", e => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    _gFilter.search = target.value.toLowerCase();
    _debouncedRenderWall();
  });
  root.querySelector("#gc-zone")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _gFilter.zone = /** @type {ZoneId | "all"} */ (target.value);
    _renderWall();
  });
  root.querySelector("#gc-status")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _gFilter.status = /** @type {StatusFilter} */ (target.value);
    _renderWall();
  });
  root.querySelector("#gc-sort")?.addEventListener("change", e => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    _gFilter.sort = /** @type {SortKey} */ (target.value);
    _renderWall();
  });
  root.querySelectorAll(".density-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".density-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const btnEl = /** @type {HTMLButtonElement} */ (btn);
      _gFilter.density = /** @type {DensityMode} */ (btnEl.dataset.d ?? "normal");
      if (_gWall) _gWall.className = `grid-wall grid-wall--${_gFilter.density}`;
    });
  });
}

// ── Wall render ───────────────────────────────────────────────────────────────

/** @returns {void} */
function _renderWall() {
  if (!_gWall) return;
  const list = _filteredSorted();

  if (!list.length) {
    _gWall.innerHTML = `<div class="grid-empty">No displays match current filters.</div>`;
    return;
  }

  _gWall.innerHTML = list.map(_buildCell).join("");

  _gWall.querySelectorAll(".gc").forEach(cell => {
    const cellEl = /** @type {HTMLElement} */ (cell);
    const id = /** @type {DisplayId} */ (cellEl.dataset.id);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let clickTimer = null;

    cellEl.addEventListener("click", () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => { clickTimer = null; _openGPanel(id); }, 220);
    });
    cellEl.addEventListener("dblclick", () => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      _openModal(id);
    });
    cellEl.addEventListener("keydown", e => {
      if (e.key === "Enter") _openGPanel(id);
    });
  });
}

/** @returns {DisplayConfig[]} */
function _filteredSorted() {
  /** @type {DisplayConfig[]} */
  let list = [...DISPLAYS];

  if (_gFilter.zone !== "all")   list = list.filter(d => d.zone === _gFilter.zone);
  if (_gFilter.status !== "all") list = list.filter(d => _getStatus(d.id) === _gFilter.status);
  if (_gFilter.search) {
    const q = _gFilter.search;
    list = list.filter(d =>
      d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)
    );
  }

  /** @type {Record<MapStatus, number>} */
  const _ord = { emergency: 0, offline: 1, degraded: 2, loading: 3, online: 4 };
  if      (_gFilter.sort === "zone")    list.sort((a, b) => a.zone.localeCompare(b.zone));
  else if (_gFilter.sort === "status")  list.sort((a, b) => (_ord[_getStatus(a.id)] ?? 5) - (_ord[_getStatus(b.id)] ?? 5));
  else if (_gFilter.sort === "updated") list.sort((a, b) =>
    (state.displays[b.id]?.lastHealthAt || "").localeCompare(state.displays[a.id]?.lastHealthAt || "")
  );
  else list.sort((a, b) => a.name.localeCompare(b.name));

  return list;
}

// ── Cell ──────────────────────────────────────────────────────────────────────

/**
 * @param {DisplayConfig} cfg
 * @returns {string}
 */
function _buildCell(cfg) {
  const id = cfg.id;
  const st = _getStatus(id);
  /** @type {Partial<DisplayState>} */
  const d  = state.displays[id] ?? {};

  return `<div class="gc gc--${st}" data-id="${_esc(id)}" tabindex="0" aria-label="${_esc(cfg.name)}">
    <div class="gc-face gc-face--${st}">${_buildCellFace(id, st, d)}</div>
    <div class="gc-bar">
      <div class="gc-bar-main">
        <span class="gc-name">${_esc(cfg.name)}</span>
        <span class="gc-sdot gc-sdot--${st}"></span>
      </div>
      <div class="gc-bar-extra">
        <span class="gc-bar-id">${_esc(id)}</span>
        <span class="gc-bar-zone">${_esc(ZONES[cfg.zone]?.label || cfg.zone)}</span>
        ${d.currentContent ? `<span class="gc-bar-content">${_esc(d.currentContent)}</span>` : ""}
      </div>
    </div>
  </div>`;
}

/**
 * @param {DisplayId} id
 * @param {MapStatus} st
 * @param {Partial<DisplayState>} d
 * @returns {string}
 */
function _buildCellFace(id, st, d) {
  if (st === "offline") {
    return `<div class="gc-offline-label">OFFLINE</div>
            <div class="gc-offline-ts">${_timeAgo(d.lastStatusAt)}</div>`;
  }
  if (st === "emergency") {
    const msg = _getActiveAlertMsg(id);
    return `<div class="gc-emergency-msg">${_esc(msg || "EMERGENCY ACTIVE")}</div>`;
  }
  if (st === "loading" || !d.currentContent) {
    return `<div class="gc-loading-label">WAITING</div>`;
  }
  return `<div class="gc-content-label">${_esc(d.currentContent)}</div>`;
}

/**
 * @param {DisplayId} id
 * @returns {string | null}
 */
function _getActiveAlertMsg(id) {
  const cfg = DISPLAYS.find(d => d.id === id);
  for (const [topic, alert] of Object.entries(state.alerts)) {
    if (_alertAffects(topic, cfg)) return alert?.message || null;
  }
  return null;
}

/**
 * @param {DisplayId} id
 * @returns {void}
 */
function _updateCell(id) {
  if (!_gWall) return;
  const el = _gWall.querySelector(`.gc[data-id="${id}"]`);
  if (!el) return;
  const cfg = DISPLAYS.find(d => d.id === id);
  if (!cfg) return;

  const st = _getStatus(id);
  /** @type {Partial<DisplayState>} */
  const d  = state.displays[id] ?? {};

  el.className = `gc gc--${st}`;
  el.innerHTML = `<div class="gc-face gc-face--${st}">${_buildCellFace(id, st, d)}</div>
    <div class="gc-bar">
      <div class="gc-bar-main">
        <span class="gc-name">${_esc(cfg.name)}</span>
        <span class="gc-sdot gc-sdot--${st}"></span>
      </div>
      <div class="gc-bar-extra">
        <span class="gc-bar-id">${_esc(id)}</span>
        <span class="gc-bar-zone">${_esc(ZONES[cfg.zone]?.label || cfg.zone)}</span>
        ${d.currentContent ? `<span class="gc-bar-content">${_esc(d.currentContent)}</span>` : ""}
      </div>
    </div>`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

/**
 * @param {DisplayId} id
 * @returns {void}
 */
function _openGPanel(id) {
  if (!_gPanel) return;
  _gPanelId = id;
  _gPanel.innerHTML = _renderPanel(id);
  _gPanel.classList.remove("closing");
  _gPanel.classList.add("open");
  _gBindPanel(id);
}

/** @returns {void} */
function _closeGPanel() {
  if (!_gPanelId || !_gPanel) return;
  _gPanelId = null;
  _gPanel.classList.add("closing");
  _gPanel.addEventListener("transitionend", () => {
    if (_gPanel) {
      _gPanel.classList.remove("open", "closing");
      _gPanel.innerHTML = "";
    }
  }, { once: true });
}

/**
 * @param {DisplayId} id
 * @returns {void}
 */
function _refreshGPanel(id) {
  if (!_gPanel) return;
  if (_gPanelId !== id) return;
  if (_gPanel.querySelector(".override-input")) return;
  const scrollTop = _gPanel.querySelector(".panel-scroll")?.scrollTop ?? 0;
  _gPanel.innerHTML = _renderPanel(id);
  _gBindPanel(id);
  const sc = _gPanel.querySelector(".panel-scroll");
  if (sc instanceof HTMLElement) sc.scrollTop = scrollTop;
}

/**
 * @param {DisplayId} id
 * @returns {void}
 */
function _gBindPanel(id) {
  if (!_gPanel) return;
  /**
   * @template {Element} T
   * @param {string} s
   * @returns {T | null}
   */
  const $ = s => /** @type {T | null} */ (_gPanel?.querySelector(s));
  /** @param {string} s */
  const $$ = s => _gPanel?.querySelectorAll(s) ?? [];

  $(/** @type {"#pnl-close"} */ ("#pnl-close"))?.addEventListener("click", _closeGPanel);

  $(/** @type {"#act-override"} */ ("#act-override"))?.addEventListener("click", () => {
    const wrap = $(/** @type {"#override-wrap"} */ ("#override-wrap"));
    if (!wrap || wrap.children.length) return;
    wrap.innerHTML = `<div class="override-form">
      <input class="override-input" id="ov-input" placeholder="Content name..." autocomplete="off">
      <div class="override-row">
        <button class="btn-primary" id="ov-submit">Publish</button>
        <button class="btn-ghost"   id="ov-cancel">Cancel</button>
      </div>
    </div>`;
    $(/** @type {"#ov-submit"} */ ("#ov-submit"))?.addEventListener("click", () => {
      const input = /** @type {HTMLInputElement | null} */ ($(/** @type {"#ov-input"} */ ("#ov-input")));
      const val = (input?.value || "").trim();
      if (!val) return;
      mqttPublish(/** @type {import("../../types/protocol").ContentDisplayOverrideTopic} */ (`content/display/${id}/override`), { content: val }, 1, true);
      wrap.innerHTML = "";
    });
    $(/** @type {"#ov-cancel"} */ ("#ov-cancel"))?.addEventListener("click", () => { wrap.innerHTML = ""; });
    const input = /** @type {HTMLInputElement | null} */ ($(/** @type {"#ov-input"} */ ("#ov-input")));
    input?.focus();
  });

  $(/** @type {"#act-restart"} */ ("#act-restart"))?.addEventListener("click", () => {
    const wrap = $(/** @type {"#restart-wrap"} */ ("#restart-wrap"));
    if (!wrap || wrap.children.length) return;
    wrap.innerHTML = `<div class="confirm-inline">
      <span>Confirm restart?</span>
      <button class="btn-amber" id="rs-yes">Restart</button>
      <button class="btn-ghost" id="rs-no">Cancel</button>
    </div>`;
    $(/** @type {"#rs-yes"} */ ("#rs-yes"))?.addEventListener("click", () => {
      mqttPublish(/** @type {import("../../types/protocol").DisplayCommandTopic} */ (`display/${id}/command`), { command: "restart" }, 1, false);
      wrap.innerHTML = "";
    });
    $(/** @type {"#rs-no"} */ ("#rs-no"))?.addEventListener("click", () => { wrap.innerHTML = ""; });
  });

  $(/** @type {"#act-maint"} */ ("#act-maint"))?.addEventListener("click", () => {
    mqttPublish(/** @type {import("../../types/protocol").MaintenanceAlertTopic} */ (`maintenance/${id}/alert`), {
      display_id: id, reason: "operator_flagged", timestamp: /** @type {import("../../types/protocol").UnixSeconds} */ (Math.floor(Date.now() / 1000)),
    }, 1, false);
  });

  $$("[data-audit-id]").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      navigateTo("audit");
    });
  });
}

// ── Full-screen modal ─────────────────────────────────────────────────────────

/**
 * @param {DisplayId} id
 * @returns {void}
 */
function _openModal(id) {
  if (!_gModal) return;
  const cfg  = DISPLAYS.find(d => d.id === id);
  /** @type {Partial<DisplayState>} */
  const d    = state.displays[id] ?? {};
  const st   = _getStatus(id);
  /** @type {Record<MapStatus, string>} */
  const lbls = { online: "Online", offline: "Offline", loading: "Waiting", degraded: "Degraded", emergency: "Emergency" };

  let cls = "", label = "";
  if (st === "offline") {
    cls   = "grid-modal-preview--offline";
    label = `Display Offline — ${_timeAgo(d.lastStatusAt)}`;
  } else if (st === "emergency") {
    cls   = "grid-modal-preview--emergency";
    label = `EMERGENCY: ${_getActiveAlertMsg(id) || "Active Alert"}`;
  } else if (st === "loading" || !d.currentContent) {
    cls   = "grid-modal-preview--loading";
    label = "Awaiting Content Assignment";
  } else {
    label = d.currentContent;
  }

  const preview = _gModal.querySelector("#gm-preview");
  const info    = _gModal.querySelector("#gm-info");
  if (preview) {
    preview.className = `grid-modal-preview ${cls}`;
    preview.innerHTML = `<div class="grid-modal-label">${_esc(label)}</div>`;
  }
  if (info) {
    info.innerHTML = `
      <div>
        <div class="grid-modal-name">${_esc(cfg?.name || id)}</div>
        <div class="grid-modal-id">${_esc(id)}</div>
      </div>
      <div class="grid-modal-status"><span class="spill ${st}">${lbls[st]}</span></div>`;
  }

  _gModal.classList.add("open");
  _gPrevFocus = document.activeElement;
  const closeBtn = _gModal.querySelector("#gm-close");
  if (closeBtn instanceof HTMLElement) closeBtn.focus();
}

/** @returns {void} */
function _closeModal() {
  if (_gModal) _gModal.classList.remove("open");
  if (_gPrevFocus && _gPrevFocus instanceof HTMLElement) {
    _gPrevFocus.focus();
  }
  _gPrevFocus = null;
}

/** @param {KeyboardEvent} e */
function _trapModalFocus(e) {
  if (e.key !== "Tab" || !_gModal) return;
  const focusable = _gModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = /** @type {HTMLElement} */ (focusable[0]);
  const last  = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
