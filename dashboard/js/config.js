"use strict";

// ── Display registry ───────────────────────────────────────────────────────
// Simulated fleet — Jakarta tech campus. IDs match tui.py launch config.
const DISPLAYS = [
  {
    id:       "A101",
    name:     "Grand Atrium A1",
    zone:     "Lobby",
    building: "Tower A",
    floor:    1,
    lat:      -6.2088,
    lng:      106.8456,
  },
  {
    id:       "A102",
    name:     "Grand Atrium A2",
    zone:     "Lobby",
    building: "Tower A",
    floor:    1,
    lat:      -6.2091,
    lng:      106.8460,
  },
  {
    id:       "B201",
    name:     "Gate Concourse B2",
    zone:     "Gate",
    building: "Tower B",
    floor:    2,
    lat:      -6.2097,
    lng:      106.8468,
  },
  {
    id:       "C301",
    name:     "Food Court C3",
    zone:     "FoodCourt",
    building: "Tower C",
    floor:    3,
    lat:      -6.2082,
    lng:      106.8474,
  },
];

// ── Zone registry ──────────────────────────────────────────────────────────
const ZONES = {
  Lobby:      { building: "Tower A", label: "Lobby" },
  Gate:       { building: "Tower B", label: "Gate" },
  FoodCourt:  { building: "Tower C", label: "Food Court" },
};

// ── Page registry ──────────────────────────────────────────────────────────
// Add entries here to extend sidebar navigation. No router code changes needed.
// topics: MQTT topic patterns this page processes (used for future per-page filtering).
const PAGES = [
  {
    id:     "map",
    label:  "Map View",
    topics: ["display/+/health", "display/+/status", "alert/#"],
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
const ALERT_TYPES = [
  { id: "fire",      label: "Fire / Evacuation",      defaultMsg: "FIRE ALARM — Evacuate immediately via nearest exit." },
  { id: "weather",   label: "Severe Weather",          defaultMsg: "SEVERE WEATHER WARNING — Seek shelter immediately." },
  { id: "security",  label: "Security / Lockdown",     defaultMsg: "SECURITY ALERT — Lockdown in effect. Remain in place." },
  { id: "hazmat",    label: "Hazardous Material",      defaultMsg: "HAZMAT ALERT — Evacuate affected area immediately." },
  { id: "medical",   label: "Medical Emergency",       defaultMsg: "MEDICAL EMERGENCY — Clear the area, await personnel." },
  { id: "power",     label: "Power / System Failure",  defaultMsg: "POWER OUTAGE — Backup systems active. Await updates." },
  { id: "custom",    label: "Custom",                  defaultMsg: "" },
];
