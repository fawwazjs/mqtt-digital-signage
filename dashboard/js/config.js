"use strict";
// @ts-check

// ── Display registry ───────────────────────────────────────────────────────
// Simulated fleet — Institut Teknologi Sepuluh Nopember deployment.
/** @type {readonly import("../types/state").DisplayConfig[]} */
const DISPLAYS = [
  {
    id:       "ITS01",
    name:     "Graha ITS Main Lobby",
    zone:     "Graha",
    building: "Graha ITS",
    floor:    1,
    lat:      -7.28102,
    lng:      112.79512,
    scopeMeters: 85,
  },
  {
    id:       "ITS02",
    name:     "Perpustakaan ITS Entrance",
    zone:     "Library",
    building: "ITS Library",
    floor:    1,
    lat:      -7.28216,
    lng:      112.79372,
    scopeMeters: 65,
  },
  {
    id:       "ITS03",
    name:     "Research Center Corridor",
    zone:     "Research",
    building: "Research Center",
    floor:    2,
    lat:      -7.27972,
    lng:      112.79708,
    scopeMeters: 70,
  },
  {
    id:       "ITS04",
    name:     "Kantin Pusat Queue",
    zone:     "Canteen",
    building: "Kantin Pusat",
    floor:    1,
    lat:      -7.28336,
    lng:      112.79642,
    scopeMeters: 75,
  },
];

// ── Zone registry ──────────────────────────────────────────────────────────
/** @type {Readonly<Partial<Record<import("../types/protocol").ZoneId, import("../types/state").ZoneConfig>>>} */
const ZONES = {
  Graha:    { building: "Graha ITS", label: "Graha ITS" },
  Library:  { building: "ITS Library", label: "Library" },
  Research: { building: "Research Center", label: "Research" },
  Canteen:  { building: "Kantin Pusat", label: "Canteen" },
};

// ── Page registry ──────────────────────────────────────────────────────────
// Add entries here to extend sidebar navigation. No router code changes needed.
// topics: MQTT topic patterns this page processes (used for future per-page filtering).
/** @type {readonly import("../types/state").PageConfig[]} */
const PAGES = [
  {
    id:     "map",
    label:  "Map View",
    topics: ["display/+/health", "display/+/status", "analytics/zone/+/viewership", "alert/#"],
    icon:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
               <path d="M10 2C7.24 2 5 4.24 5 7c0 4 5 11 5 11s5-7 5-11c0-2.76-2.24-5-5-5z"/>
               <circle cx="10" cy="7" r="1.75"/>
             </svg>`,
  },
  {
    id:     "grid",
    label:  "Live Grid",
    topics: ["display/+/health", "display/+/status", "alert/#", "content/zone/+/schedule"],
    icon:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
               <rect x="2"  y="2"  width="7" height="7" rx="1"/>
               <rect x="11" y="2"  width="7" height="7" rx="1"/>
               <rect x="2"  y="11" width="7" height="7" rx="1"/>
               <rect x="11" y="11" width="7" height="7" rx="1"/>
             </svg>`,
  },
  {
    id:     "content-mgmt",
    label:  "Content",
    topics: ["content/zone/+/schedule", "content/display/+/override", "alert/#"],
    icon:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
               <rect x="3" y="2" width="14" height="16" rx="1.5"/>
               <line x1="6" y1="7"  x2="14" y2="7"/>
               <line x1="6" y1="10" x2="14" y2="10"/>
               <line x1="6" y1="13" x2="11" y2="13"/>
             </svg>`,
  },
  {
    id:     "analytics",
    label:  "Analytics",
    topics: ["analytics/zone/+/viewership", "display/+/health", "display/+/status", "alert/#", "content/zone/+/schedule", "maintenance/+/alert"],
    icon:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
               <path d="M3 17V3"/><path d="M3 17h14"/>
               <rect x="6" y="10" width="2.8" height="4"/>
               <rect x="10" y="6" width="2.8" height="8"/>
               <rect x="14" y="8" width="2.8" height="6"/>
             </svg>`,
  },
  {
    id:     "notifications",
    label:  "Notifications",
    badge:  true,
    topics: ["display/+/status", "alert/#", "maintenance/+/alert"],
    icon:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
               <path d="M10 2a6 6 0 0 1 6 6v3l1.5 2.5h-15L4 11V8a6 6 0 0 1 6-6z"/>
               <path d="M8 16.5a2 2 0 0 0 4 0"/>
             </svg>`,
  },
  {
    id:     "audit",
    label:  "Audit Log",
    topics: [],
    icon:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
               <rect x="3" y="3" width="14" height="14" rx="1.5"/>
               <line x1="6" y1="7.5"  x2="14" y2="7.5"/>
               <line x1="6" y1="10.5" x2="14" y2="10.5"/>
               <line x1="6" y1="13.5" x2="11" y2="13.5"/>
             </svg>`,
  },
];

// ── Alert type definitions ─────────────────────────────────────────────────
/** @type {readonly import("../types/state").AlertTypeConfig[]} */
const ALERT_TYPES = [
  { id: "fire",      label: "Fire / Evacuation",      defaultMsg: "FIRE ALARM — Evacuate immediately via nearest exit." },
  { id: "weather",   label: "Severe Weather",          defaultMsg: "SEVERE WEATHER WARNING — Seek shelter immediately." },
  { id: "security",  label: "Security / Lockdown",     defaultMsg: "SECURITY ALERT — Lockdown in effect. Remain in place." },
  { id: "hazmat",    label: "Hazardous Material",      defaultMsg: "HAZMAT ALERT — Evacuate affected area immediately." },
  { id: "medical",   label: "Medical Emergency",       defaultMsg: "MEDICAL EMERGENCY — Clear the area, await personnel." },
  { id: "power",     label: "Power / System Failure",  defaultMsg: "POWER OUTAGE — Backup systems active. Await updates." },
  { id: "custom",    label: "Custom",                  defaultMsg: "" },
];
