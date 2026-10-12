// Advisory Boards — service catalog, storage helpers, and shared constants.
//
// Boards persist to the backend (Phase 1 MABM API). The service catalog now
// lives on the backend too (super admins manage it from the admin panel) and
// is fetched lazily into an in-memory cache. KOLs are still localStorage.

import { useEffect, useState } from 'react';
import {
  listAdvisoryBoards as apiListBoards,
  createAdvisoryBoard as apiCreateBoard,
  getAdvisoryBoard   as apiGetBoard,
  updateAdvisoryBoard as apiUpdateBoard,
  deleteAdvisoryBoard as apiDeleteBoard,
  listAdvisoryServices as apiListServices,
} from '../../services/api';

export const PHASES = [
  { id: 'pre_meeting',     label: 'Pre-Meeting',           short: 'Pre',     color: 'var(--color-primary)' },
  { id: 'meeting',         label: 'Meeting',               short: 'Meeting', color: 'var(--color-info)' },
  { id: 'post_meeting',    label: 'Post-Meeting',          short: 'Post',    color: 'var(--color-success)' },
  { id: 'ongoing_support', label: 'Ongoing Support',       short: 'Ongoing', color: 'var(--color-warning)' },
  { id: 'event_specific',  label: 'Event-Specific',        short: 'Event',   color: 'var(--color-pink)' },
];

export const PHASE_BY_ID = Object.fromEntries(PHASES.map(p => [p.id, p]));

export const FEE_UNITS = [
  { id: 'fixed',       label: 'Fixed fee' },
  { id: 'hourly',      label: 'Per hour' },
  { id: 'per_day',     label: 'Per day' },
  { id: 'per_kol',     label: 'Per KOL' },
  { id: 'per_region',  label: 'Per region' },
  { id: 'per_seat',    label: 'Per participant' },
];

export const BOARD_STATUSES = [
  { id: 'planning',    label: 'Planning',    color: 'var(--color-primary)' },
  { id: 'scheduled',   label: 'Scheduled',   color: 'var(--color-info)' },
  { id: 'in_progress', label: 'In Progress', color: 'var(--color-warning)' },
  { id: 'completed',   label: 'Completed',   color: 'var(--color-success)' },
  { id: 'cancelled',   label: 'Cancelled',   color: 'var(--color-error)' },
];

export const BOARD_STATUS_BY_ID = Object.fromEntries(BOARD_STATUSES.map(s => [s.id, s]));

// ── Service catalog ─────────────────────────────────────────────────────
// Lives on the backend (advisory_services table). We keep a live in-memory
// cache so legacy synchronous accessors (`SERVICE_BY_ID[id]`, `SERVICES`)
// keep working — components mount, call `useServiceCatalog()`, and the cache
// gets populated on first render. The exported `SERVICES` array is mutated
// in place so all consumers share the same reference.
//
// The frontend SERVICE shape (id, phase, name, desc, feeLabel, defaultUnit)
// is a thin adapter on top of the backend AdvisoryService row (slug, phase,
// name, description, fee_label, default_unit, default_price, currency).
export const SERVICES = [];
let _catalogLoaded = false;
let _catalogLoading = null;
const _catalogSubscribers = new Set();

const _serviceFromApi = (row) => ({
  id: row.slug,
  slug: row.slug,
  phase: row.phase,
  name: row.name,
  desc: row.description || '',
  feeLabel: row.fee_label || '',
  defaultUnit: row.default_unit,
  defaultPrice: Number(row.default_price) || 0,
  currency: row.currency || 'USD',
  isActive: !!row.is_active,
  sortOrder: row.sort_order || 0,
});

const _rebuildIndex = () => {
  for (const k of Object.keys(SERVICE_BY_ID)) delete SERVICE_BY_ID[k];
  for (const s of SERVICES) SERVICE_BY_ID[s.id] = s;
};

export const loadServiceCatalog = async ({ force = false } = {}) => {
  if (_catalogLoaded && !force) return SERVICES;
  if (_catalogLoading && !force) return _catalogLoading;
  _catalogLoading = (async () => {
    try {
      const r = await apiListServices();
      const next = (r.data || []).filter((s) => s.is_active).map(_serviceFromApi);
      SERVICES.length = 0;
      SERVICES.push(...next);
      _rebuildIndex();
      _catalogLoaded = true;
      _catalogSubscribers.forEach((fn) => { try { fn(); } catch {} });
      return SERVICES;
    } finally {
      _catalogLoading = null;
    }
  })();
  return _catalogLoading;
};

// Hook — call from any component that depends on SERVICES. Returns a
// re-render trigger so consumers refresh when the catalog populates.
export const useServiceCatalog = () => {
  const [, setTick] = useState(0);
  const [error, setError] = useState(null);
  useEffect(() => {
    let mounted = true;
    const onChange = () => { if (mounted) setTick((t) => t + 1); };
    _catalogSubscribers.add(onChange);
    if (!_catalogLoaded) {
      loadServiceCatalog().catch((e) => { if (mounted) setError(e); });
    }
    return () => { mounted = false; _catalogSubscribers.delete(onChange); };
  }, []);
  return { services: SERVICES, loading: !_catalogLoaded, error };
};

export const SERVICE_BY_ID = Object.fromEntries(SERVICES.map(s => [s.id, s]));

export const groupServicesByPhase = () => {
  const grouped = {};
  for (const phase of PHASES) grouped[phase.id] = [];
  for (const svc of SERVICES) grouped[svc.phase].push(svc);
  return grouped;
};

// ─── Storage layer ──────────────────────────────────────────────────────
// Keys are namespaced. JSON-serialised arrays/objects so it's trivial to
// move to a real API later.

const KEYS = {
  // boards key kept for migration awareness only — boards now live on the backend
  kols:    'advisoryBoards.kols.v1',
  pricing: 'advisoryBoards.pricing.v1',
};

const safeRead = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const safeWrite = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / disabled */ }
};

const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Coerce a value that may be a string (legacy single-select) or an array
// (current multi-select) into a clean string array.
export const toList = (v) => {
  if (Array.isArray(v)) return v.map((x) => (x || '').toString().trim()).filter(Boolean);
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? [t] : [];
  }
  return [];
};

// ── Boards (async — backend) ──
// All four functions return Promises. The api.js layer handles camelCase ↔
// snake_case mapping via boardToApi/boardFromApi adapters, so callers see the
// same shape as the old localStorage version.

export const listBoards = async () => {
  const r = await apiListBoards();
  return r.data || [];
};

export const getBoard = async (id) => {
  const r = await apiGetBoard(id);
  return r.data;
};

export const createBoard = async (input) => {
  const payload = {
    title: input.title?.trim() || 'Untitled Advisory Board',
    client: input.client?.trim() || '',
    sponsor: input.sponsor?.trim() || '',
    therapeuticArea: toList(input.therapeuticArea),
    region: toList(input.region),
    currency: input.currency || 'USD',
    status: input.status || 'planning',
    currentPhase: input.currentPhase || 'pre_meeting',
    scheduledDate: input.scheduledDate || null,
    startTime: input.startTime || null,
    endTime: input.endTime || null,
    format: input.format || 'hybrid',
    venue: input.venue?.trim() || '',
    objective: input.objective?.trim() || '',
    notes: input.notes || '',
    kolIds: input.kolIds || [],
    serviceIds: input.serviceIds || [],
  };
  const r = await apiCreateBoard(payload);
  return r.data;
};

export const updateBoard = async (id, patch) => {
  const normalized = { ...patch };
  if ('therapeuticArea' in normalized) normalized.therapeuticArea = toList(normalized.therapeuticArea);
  if ('region' in normalized)          normalized.region          = toList(normalized.region);
  if ('scheduledDate' in normalized && !normalized.scheduledDate) normalized.scheduledDate = null;
  const r = await apiUpdateBoard(id, normalized);
  return r.data;
};

export const deleteBoard = async (id) => {
  await apiDeleteBoard(id);
};

// ── KOLs ──
export const listKols = () => safeRead(KEYS.kols, []);

export const saveKols = (kols) => safeWrite(KEYS.kols, kols);

export const createKol = (input) => {
  const kols = listKols();
  const kol = {
    id: newId('kol'),
    name: input.name?.trim() || 'Unnamed KOL',
    specialty: input.specialty?.trim() || '',
    affiliation: input.affiliation?.trim() || '',
    country: input.country?.trim() || '',
    email: input.email?.trim() || '',
    phone: input.phone?.trim() || '',
    tier: input.tier || 'tier_2',          // tier_1 (KOL+), tier_2, tier_3
    notes: input.notes || '',
    createdAt: new Date().toISOString(),
  };
  kols.unshift(kol);
  saveKols(kols);
  return kol;
};

export const updateKol = (id, patch) => {
  const kols = listKols();
  const idx = kols.findIndex(k => k.id === id);
  if (idx === -1) return null;
  kols[idx] = { ...kols[idx], ...patch };
  saveKols(kols);
  return kols[idx];
};

export const deleteKol = (id) => {
  const kols = listKols().filter(k => k.id !== id);
  saveKols(kols);
  // Note: dangling kolIds in backend boards are tolerated by the UI (the KOL
  // simply won't render). A board-side cleanup pass can be added later.
};

// ── Pricing ──
// The catalog itself owns price + currency now (set by super admins via the
// admin app). End users see those values; there's no per-user override layer.
export const priceForService = (serviceId) => {
  const svc = SERVICE_BY_ID[serviceId];
  if (!svc) return { unit: 'fixed', price: 0, currency: 'USD', isCustom: false };
  return {
    unit:     svc.defaultUnit || 'fixed',
    price:    Number(svc.defaultPrice) || 0,
    currency: svc.currency || 'USD',
    isCustom: false,
  };
};

// Estimate cost for a board's selected services. Multipliers come from board
// fields (kol count for per_kol, etc.). For units we don't know how to scale,
// we fall back to qty=1 — the super admin can override per-board later.
export const estimateBoardCost = (board) => {
  if (!board) return { total: 0, currency: 'USD', lines: [] };
  const kolCount  = (board.kolIds || []).length || 1;
  const seatCount = kolCount; // same default; the UI lets users override later
  const regions   = 1;
  const days      = 1;
  const hours     = 1;

  const lines = (board.serviceIds || []).map(sid => {
    const svc = SERVICE_BY_ID[sid];
    if (!svc) return null;
    const p = priceForService(sid);
    let qty = 1;
    switch (p.unit) {
      case 'per_kol':    qty = kolCount;  break;
      case 'per_seat':   qty = seatCount; break;
      case 'per_region': qty = regions;   break;
      case 'per_day':    qty = days;      break;
      case 'hourly':     qty = hours;     break;
      default:           qty = 1;
    }
    return { service: svc, unit: p.unit, unitPrice: p.price, qty, lineTotal: p.price * qty, currency: p.currency };
  }).filter(Boolean);

  const total = lines.reduce((s, l) => s + l.lineTotal, 0);
  const currency = lines[0]?.currency || board.currency || 'USD';
  return { total, currency, lines };
};

// Derive a meeting's default scheduledAt (datetime-local string "YYYY-MM-DDTHH:MM")
// and duration (minutes) from a board's scheduled date + start/end time, so a
// meeting created off a board inherits the board's timing.
export const boardMeetingTimeDefaults = (board) => {
  if (!board) return { scheduledAt: '', duration: 60 };
  const date  = (board.scheduledDate || '').slice(0, 10);
  const start = board.startTime || '';
  const end   = board.endTime || '';
  let scheduledAt = '';
  if (date) scheduledAt = `${date}T${start || '09:00'}`;
  let duration = 60;
  if (start && end) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff > 0) duration = diff;
  }
  return { scheduledAt, duration };
};

export const formatMoney = (amount, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
  } catch {
    return `${currency} ${Math.round(amount || 0).toLocaleString()}`;
  }
};
