import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, Plus, Users, Stethoscope, Building2, Mail, Trash2, Pencil,
  X, SlidersHorizontal, Loader, AlertCircle, XCircle, ClipboardCheck, Filter,
  Phone, MapPin, Award, Briefcase, BadgeCheck, Globe2, FileSearch, FileText, Hourglass, Download,
  ChevronRight, FlaskConical, List, BarChart3,
} from 'lucide-react';
import { ClipboardList } from 'lucide-react';
import Pagination from '../components/Pagination';
import { COUNTRIES } from '../utils/countries';
import { TITLES, kolName } from '../utils/kolName';
import {
  listKOLs, getKOLFacets, createKOL, updateKOL, deleteKOL, getMe, listPendingKOLs,
  enrichKOLsBulk, deleteKOLsBulk, getExperienceMissing, fetchExperience, updateKOLsFromCTRIBulk,
} from '../services/api';
import { ScrapeModal, PendingPanel, CTRICaptcha } from './KOLScrapePanel';
import KOLExportModal from './KOLExportModal';
import KOLInsights from './KOLInsights';

// Must match INFLUENCE_LEVELS in backend/app/models/kol_directory.py.
const INFLUENCE_LEVELS = ['Global', 'National', 'Regional', 'Local', 'Emerging'];

export const INFLUENCE_STYLE = {
  Global: { color: 'var(--color-primary)', bg: 'var(--color-primary-bg)' },
  National: { color: 'var(--color-accent)', bg: 'var(--color-info-bg)' },
  Regional: { color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
  Local: { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  Emerging: { color: 'var(--color-pink)', bg: 'var(--color-pink-bg)' },
};

export const SOURCE_LABELS = {
  manual: { label: 'Added manually', color: 'var(--color-primary)', bg: 'var(--color-primary-bg)', short: 'Manual' },
  import: { label: 'Imported', color: 'var(--color-accent)', bg: 'var(--color-info-bg)', short: 'Imported' },
  hcp: { label: 'From HCP profile', color: 'var(--color-success)', bg: 'var(--color-success-bg)', short: 'HCP' },
  google: { label: 'Google search', color: 'var(--color-success)', bg: 'var(--color-success-bg)', short: 'Google' },
  ctri: { label: 'CTRI', color: 'var(--color-violet)', bg: 'var(--color-violet-bg)', short: 'CTRI' },
  pubmed: { label: 'PubMed', color: 'var(--color-accent)', bg: 'var(--color-info-bg)', short: 'PubMed' },
  ctgov: { label: 'ClinicalTrials.gov', color: 'var(--color-violet)', bg: 'var(--color-violet-bg)', short: 'CT.gov' },
};

// Filter rail: facet response key -> [display title, icon, query-param name]
const FACET_CONFIG = [
  ['geographic_zones', 'Country', Globe2, 'geographic_zone'],
  ['state_cities', 'State / City', MapPin, 'state_city'],
  ['therapeutic_areas', 'Therapeutic Area', Stethoscope, 'therapeutic_area'],
  ['specialties', 'Specialty', BadgeCheck, 'specialty'],
  ['subspecialties', 'Subspecialty', BadgeCheck, 'subspecialty'],
  ['institutions', 'Society / Hospital / Institution', Building2, 'institution'],
  ['designations', 'Designation', Briefcase, 'designation'],
  ['influence_levels', 'Influence Level', Award, 'influence_level'],
  ['functional_expertises', 'Functional Expertise', Filter, 'functional_expertise'],
];

export const EMPTY_FACETS = {
  therapeutic_areas: [], geographic_zones: [], state_cities: [], specialties: [],
  subspecialties: [], institutions: [], designations: [], influence_levels: [],
  functional_expertises: [], total: 0,
};

const EMPTY_FORM = {
  title: '', first_name: '', last_name: '', email: '', contact_no: '',
  therapeutic_area: '', geographic_zone: '', state_city: '', specialty: '',
  subspecialty: '', institution: '', designation: '', influence_level: '',
  functional_expertise: '', experience_years: '', notes: '',
};

const AVATAR_COLORS = [
  ['var(--color-primary-bg)', 'var(--color-primary)'], ['var(--color-info-bg)', 'var(--color-accent)'], ['var(--color-success-bg)', 'var(--color-success)'],
  ['var(--color-warning-bg)', 'var(--color-warning)'], ['var(--color-pink-bg)', 'var(--color-pink)'], ['var(--color-violet-bg)', 'var(--color-violet)'],
];

export function avatarFor(kol) {
  const name = `${kol.first_name || ''} ${kol.last_name || ''}`.trim();
  const initials = name
    ? name.split(/\s+/).filter(p => !/^(dr|dr\.|prof|prof\.)$/i.test(p)).slice(0, 2).map(p => p[0]).join('').toUpperCase()
    : '?';
  let hash = 0;
  for (const ch of (kol.email || name || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return { initials, colors: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
}

// ─── Add / Edit modal ────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'var(--color-text-light)', margin: '20px 0 10px',
      borderTop: '1px solid var(--color-border-light)', paddingTop: 16,
    }}>
      {children}
    </div>
  );
}

export function KOLFormModal({ kol, facets, onClose, onSaved }) {
  const isEdit = Boolean(kol);
  const [form, setForm] = useState(kol ? { ...EMPTY_FORM, ...kol } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const trimmed = (key) => form[key]?.trim() || null;

  const handleSave = async () => {
    if (!form.first_name?.trim() && !form.last_name?.trim()) {
      setError('Please enter at least a first or last name.');
      return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        title: form.title || null,
        first_name: trimmed('first_name'), last_name: trimmed('last_name'),
        email: trimmed('email'), contact_no: trimmed('contact_no'),
        therapeutic_area: trimmed('therapeutic_area'), geographic_zone: trimmed('geographic_zone'),
        state_city: trimmed('state_city'), specialty: trimmed('specialty'),
        subspecialty: trimmed('subspecialty'), institution: trimmed('institution'),
        designation: trimmed('designation'), influence_level: trimmed('influence_level'),
        functional_expertise: trimmed('functional_expertise'), notes: trimmed('notes'),
        experience_years: form.experience_years === '' || form.experience_years == null
          ? null : Number(form.experience_years),
      };
      if (isEdit) await updateKOL(kol.id, payload);
      else await createKOL(payload);
      onSaved();
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === 'string' ? detail
          : Array.isArray(detail) ? (detail[0]?.msg || 'Please check the highlighted fields.')
            : 'Failed to save KOL. Please try again.'
      );
      setSaving(false);
    }
  };

  // Suggests values already in use, so entries stay consistent without being locked down.
  const suggest = (facetKey, id) => (
    <datalist id={id}>
      {(facets[facetKey] || []).map(f => <option key={f.value} value={f.value} />)}
    </datalist>
  );

  const two = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 640, maxHeight: '88vh', overflow: 'auto', padding: 0 }}
        onClick={e => e.stopPropagation()}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 1,
        }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem' }}>{isEdit ? 'Edit KOL' : 'Add KOL'}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} /> <span>{error}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 14 }}>
            <Field label="Title">
              <select className="form-control" value={form.title || ''} onChange={e => set('title', e.target.value)}>
                <option value="">—</option>
                {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="First Name">
              <input className="form-control" value={form.first_name || ''} autoFocus
                onChange={e => set('first_name', e.target.value)} placeholder="Geetanjali" />
            </Field>
            <Field label="Last Name">
              <input className="form-control" value={form.last_name || ''}
                onChange={e => set('last_name', e.target.value)} placeholder="Shetty" />
            </Field>
          </div>
          <div style={{ ...two, marginTop: 14 }}>
            <Field label="Email Address">
              <input className="form-control" type="email" value={form.email || ''}
                onChange={e => set('email', e.target.value)} placeholder="name@example.com" />
            </Field>
            <Field label="Contact No.">
              <input className="form-control" value={form.contact_no || ''}
                onChange={e => set('contact_no', e.target.value)} placeholder="9123837286 / 9830316133" />
            </Field>
          </div>

          <SectionTitle>Location</SectionTitle>
          <div style={two}>
            <Field label="Country">
              <input className="form-control" list="dl-zone" value={form.geographic_zone || ''}
                onChange={e => set('geographic_zone', e.target.value)} placeholder="India" />
              <datalist id="dl-zone">
                {[...new Set([...COUNTRIES, ...(facets.geographic_zones || []).map(f => f.value)])]
                  .map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>
            <Field label="State / City">
              <input className="form-control" list="dl-statecity" value={form.state_city || ''}
                onChange={e => set('state_city', e.target.value)} placeholder="Maharashtra / Mumbai" />
              {suggest('state_cities', 'dl-statecity')}
            </Field>
          </div>

          <SectionTitle>Professional Profile</SectionTitle>
          <div style={two}>
            <Field label="Therapeutic Area">
              <input className="form-control" list="dl-ta" value={form.therapeutic_area || ''}
                onChange={e => set('therapeutic_area', e.target.value)} placeholder="Dermatologist" />
              {suggest('therapeutic_areas', 'dl-ta')}
            </Field>
            <Field label="Specialty">
              <input className="form-control" list="dl-spec" value={form.specialty || ''}
                onChange={e => set('specialty', e.target.value)} placeholder="Dermatology" />
              {suggest('specialties', 'dl-spec')}
            </Field>
          </div>
          <div style={{ ...two, marginTop: 14 }}>
            <Field label="Subspecialty">
              <input className="form-control" list="dl-subspec" value={form.subspecialty || ''}
                onChange={e => set('subspecialty', e.target.value)} placeholder="Pediatric Dermatology" />
              {suggest('subspecialties', 'dl-subspec')}
            </Field>
            <Field label="Functional Expertise">
              <input className="form-control" list="dl-func" value={form.functional_expertise || ''}
                onChange={e => set('functional_expertise', e.target.value)} placeholder="Clinical Trials" />
              {suggest('functional_expertises', 'dl-func')}
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="Society / Hospital / Institution">
              <input className="form-control" list="dl-inst" value={form.institution || ''}
                onChange={e => set('institution', e.target.value)} placeholder="e.g. AIIMS, IADVL" />
              {suggest('institutions', 'dl-inst')}
            </Field>
          </div>
          <div style={{ ...two, marginTop: 14 }}>
            <Field label="Total Experience (years)">
              <input className="form-control" type="number" min="0" max="80" value={form.experience_years ?? ''}
                onChange={e => set('experience_years', e.target.value)} placeholder="e.g. 15" />
            </Field>
          </div>
          <div style={{ ...two, marginTop: 14 }}>
            <Field label="Designation">
              <input className="form-control" list="dl-desig" value={form.designation || ''}
                onChange={e => set('designation', e.target.value)} placeholder="Professor, HOD" />
              {suggest('designations', 'dl-desig')}
            </Field>
            <Field label="Influence Level">
              <select className="form-control" value={form.influence_level || ''}
                onChange={e => set('influence_level', e.target.value)}>
                <option value="">— Not set —</option>
                {INFLUENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </div>

          <SectionTitle>Notes</SectionTitle>
          <textarea className="form-control" rows={3} value={form.notes || ''}
            onChange={e => set('notes', e.target.value)} placeholder="Optional notes about this KOL" />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader size={14} className="spinning" /> Saving</> : (isEdit ? 'Save Changes' : 'Add KOL')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Update existing KOLs from CTRI ──────────────────────
// One CTRI search (one security code) by keyword; the investigators of the
// matching trials are name-matched against the directory in the background.
function CTRIBulkModal({ defaultKeyword, selectedIds, onClose, onStarted }) {
  const [keyword, setKeyword] = useState(defaultKeyword || '');
  const [onlySelected, setOnlySelected] = useState(selectedIds.length > 0);
  const [ctri, setCtri] = useState({ session: '', captcha: '' });
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!keyword.trim()) { setError('Enter a keyword to search CTRI for.'); return; }
    if (!ctri.captcha) { setError('Type the CTRI security code.'); return; }
    setBusy(true); setError('');
    try {
      const res = await updateKOLsFromCTRIBulk({
        ...ctri, keyword: keyword.trim(), ids: onlySelected ? selectedIds : [],
      });
      onStarted(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'CTRI update failed.');
      setNonce(n => n + 1);   // a code is good for one search
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Update KOLs from CTRI</h3>
          <button className="modal-close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} /> <span>{error}</span>
            </div>
          )}
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: 0 }}>
            Searches the Clinical Trials Registry - India once, then reads the investigators of the newest
            matching trials and adds those trials to every KOL whose name matches. Blank email, phone,
            institution and location are filled in; nothing you entered is overwritten.
          </p>
          <label className="form-label">Search CTRI for</label>
          <input className="form-control" value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder="e.g. Dermatology, Psoriasis, AIIMS" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.84rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlySelected} disabled={!selectedIds.length}
              onChange={e => setOnlySelected(e.target.checked)} />
            {selectedIds.length
              ? `Only the ${selectedIds.length} selected KOL${selectedIds.length === 1 ? '' : 's'}`
              : 'Every KOL in the directory (select rows to narrow it down)'}
          </label>
          <label className="form-label" style={{ marginTop: 14 }}>CTRI security code</label>
          <CTRICaptcha nonce={nonce} onChange={setCtri} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || !ctri.captcha}>
            {busy ? <><Loader size={14} className="spinning" /> Searching…</> : 'Search & update'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Filter row ──────────────────────────────────────────
// One compact dropdown per facet that has data, laid out in a single row.
function FacetSelect({ title, icon: Icon, values, selected, onSelect }) {
  if (!values?.length) return null;
  const isActive = Boolean(selected);
  return (
    <div style={{ position: 'relative', flex: '1 0 150px', minWidth: 150, maxWidth: 230 }} title={title}>
      <Icon size={13} style={{
        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none',
        color: isActive ? 'var(--color-primary)' : 'var(--color-text-light)',
      }} />
      <select className="form-control" value={selected} onChange={e => onSelect(e.target.value)}
        aria-label={title}
        style={{
          paddingLeft: 30, fontSize: '0.82rem', height: 36,
          ...(isActive && { borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontWeight: 600, background: 'var(--color-primary-bg)' }),
        }}>
        <option value="">{title}</option>
        {values.map(f => (
          <option key={f.value} value={f.value}>{f.label || f.value}{f.count != null ? ` (${f.count})` : ''}</option>
        ))}
      </select>
    </div>
  );
}

export default function FindKOLsTab() {
  const [kols, setKols] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState(EMPTY_FACETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [source, setSource] = useState('');
  // One entry per facet, keyed by query-param name.
  const [selected, setSelected] = useState({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const navigate = useNavigate();
  const [bulkBusy, setBulkBusy] = useState(false);

  // Bulk delete — ids of the cards ticked for removal. Kept across pages so a
  // selection can span several; cleared whenever the filters change.
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);

  // Total experience for KOLs saved before the scrape captured it.
  const [expMissing, setExpMissing] = useState({ directory: 0, pending: 0 });
  const [expPanel, setExpPanel] = useState(false);
  const [expUseSearch, setExpUseSearch] = useState(false);
  const [expRunning, setExpRunning] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCtri, setShowCtri] = useState(false);

  // Scrape / approval workflow
  // Directory / Pending lives in the URL (?tab=find-kols&view=pending) so a
  // refresh stays on the view the user was looking at.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'pending' ? 'pending' : 'directory';
  const setView = useCallback((v) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === 'pending') next.set('view', v); else next.delete('view');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // Directory as a list or as charts (?display=charts), so a refresh keeps it.
  const display = searchParams.get('display') === 'charts' ? 'charts' : 'list';
  const setDisplay = useCallback((d) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (d === 'charts') next.set('display', d); else next.delete('display');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const insightsNotice = useCallback((text, level) => setNotice({ text, level: level || 'error' }), []);
  const [showScrape, setShowScrape] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState(null);       // { text, level }

  useEffect(() => {
    getMe().then((r) => setIsAdmin(['admin', 'super_admin'].includes(r.data.role))).catch(() => {});
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      // Only the count is needed — don't pull the whole queue for a badge.
      const r = await listPendingKOLs('pending', { limit: 1 });
      setPendingCount(r.data.pending ?? (r.data.items || []).length);
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => { refreshPending(); }, [refreshPending]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const selectedKey = JSON.stringify(selected);
  useEffect(() => { setPage(1); }, [debouncedSearch, selectedKey, source, sort]);
  useEffect(() => { setCheckedIds(new Set()); }, [debouncedSearch, selectedKey, source, sort]);

  const fetchFacets = useCallback(async () => {
    try {
      const res = await getKOLFacets();
      setFacets({ ...EMPTY_FACETS, ...res.data });
    } catch { /* facets are decorative — a failure shouldn't block the list */ }
  }, []);

  // `quiet` skips the spinner — used by the enrichment poller so the grid doesn't
  // flicker every few seconds while details are being fetched.
  const fetchKOLs = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const active = Object.fromEntries(
        Object.entries(JSON.parse(selectedKey)).filter(([, v]) => v)
      );
      const res = await listKOLs({
        skip: (page - 1) * pageSize,
        limit: pageSize,
        search: debouncedSearch || undefined,
        source: source || undefined,
        sort,
        ...active,
      });
      setKols(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load KOLs.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, selectedKey, source, sort]);

  useEffect(() => { fetchKOLs(); }, [fetchKOLs]);

  // While any KOL on this page is being enriched, poll so the cards flip from
  // "fetching" to the publication count on their own.
  const anyRunning = kols.some(k => k.enrichment_status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => fetchKOLs(true), 2500);
    return () => clearInterval(t);
  }, [anyRunning, fetchKOLs]);
  useEffect(() => { fetchFacets(); }, [fetchFacets]);

  const handleSaved = async () => {
    setShowForm(false); setEditing(null);
    await Promise.all([fetchKOLs(), fetchFacets()]);
  };

  const handleDelete = async (kol) => {
    const name = kolName(kol, 'this KOL');
    if (!window.confirm(`Remove ${name} from the KOL database?`)) return;
    try {
      await deleteKOL(kol.id);
      setCheckedIds(prev => { const next = new Set(prev); next.delete(kol.id); return next; });
      await Promise.all([fetchKOLs(), fetchFacets()]);
    } catch {
      setError('Failed to delete KOL.');
    }
  };

  const toggleChecked = (id) => setCheckedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPageChecked = kols.length > 0 && kols.every(k => checkedIds.has(k.id));
  const toggleCheckPage = () => setCheckedIds(prev => {
    const next = new Set(prev);
    kols.forEach(k => (allOnPageChecked ? next.delete(k.id) : next.add(k.id)));
    return next;
  });

  const handleBulkDelete = async () => {
    const n = checkedIds.size;
    if (!n) return;
    if (!window.confirm(`Remove ${n} KOL${n === 1 ? '' : 's'} from the KOL database? This cannot be undone.`)) return;
    setDeletingBulk(true);
    try {
      const res = await deleteKOLsBulk([...checkedIds]);
      const deleted = res.data.deleted ?? 0;
      setCheckedIds(new Set());
      setNotice({
        text: `Removed ${deleted} KOL${deleted === 1 ? '' : 's'}`
          + (deleted < n ? ` — ${n - deleted} could not be removed (not yours or already gone).` : '.'),
        level: 'success',
      });
      // Deleting a whole last page would leave it empty — step back one.
      if (page > 1 && kols.every(k => checkedIds.has(k.id))) setPage(p => p - 1);
      await Promise.all([fetchKOLs(), fetchFacets()]);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete the selected KOLs.');
    } finally {
      setDeletingBulk(false);
    }
  };

  // Same fetch for every KOL shown on this page that doesn't have details yet.
  const missingDetails = kols.filter(k => !['done', 'running'].includes(k.enrichment_status));
  const handleFetchAllDetails = async () => {
    if (!missingDetails.length) return;
    setBulkBusy(true);
    try {
      const res = await enrichKOLsBulk(missingDetails.map(k => k.id));
      setNotice({
        text: `Fetching publications & trials for ${res.data.queued} KOL${res.data.queued === 1 ? '' : 's'} — this runs in the background.`,
        level: 'success',
      });
      fetchKOLs(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not start the fetch.');
    } finally {
      setBulkBusy(false);
    }
  };

  const refreshExpMissing = useCallback(async () => {
    try {
      const r = await getExperienceMissing();
      setExpMissing(r.data);
      return r.data;
    } catch { return null; }
  }, []);
  useEffect(() => { refreshExpMissing(); }, [refreshExpMissing]);
  const expTotal = expMissing.directory + expMissing.pending;

  const handleFetchExperience = async () => {
    setExpPanel(false); setExpRunning(true);
    try {
      const r = await fetchExperience(expUseSearch);
      setNotice({
        text: `Looking up total experience for ${r.data.queued} KOL${r.data.queued === 1 ? '' : 's'} in the background — cards update as it finishes.`,
        level: 'success',
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not start the experience lookup.');
      setExpRunning(false);
    }
  };

  // Poll while the lookup runs; it's done once the missing count stops moving.
  useEffect(() => {
    if (!expRunning) return;
    let last = null, still = 0;
    const t = setInterval(async () => {
      const d = await refreshExpMissing();
      fetchKOLs(true);
      const n = d ? d.directory + d.pending : null;
      still = n === last ? still + 1 : 0;
      last = n;
      if (n === 0 || still >= 6) setExpRunning(false);
    }, 5000);
    return () => clearInterval(t);
  }, [expRunning, refreshExpMissing, fetchKOLs]);

  const pick = (param, value) => setSelected(s => ({ ...s, [param]: value }));
  const clearFilters = () => { setSearch(''); setSelected({}); setSource(''); };

  const activeFilters = [
    ...Object.entries(selected).filter(([, v]) => v).map(([param, value]) => ({
      label: value, clear: () => pick(param, ''),
    })),
    source && { label: SOURCE_LABELS[source]?.label || source, clear: () => setSource('') },
    debouncedSearch && { label: `"${debouncedSearch}"`, clear: () => setSearch('') },
  ].filter(Boolean);

  return (
    <>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1, marginLeft: 8 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <XCircle size={16} />
          </button>
        </div>
      )}

      {notice && (
        <div className={`alert ${notice.level === 'success' ? 'alert-success' : 'alert-error'}`}
          style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} /> <span>{notice.text}</span>
        </div>
      )}

      {/* Directory / Pending toggle + Scrape button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${view === 'directory' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setView('directory')}>
          <Users size={14} /> Directory
        </button>
        <button className={`btn btn-sm ${view === 'pending' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setView('pending'); refreshPending(); }}>
          <ClipboardList size={14} /> Pending Verification
          {pendingCount > 0 && (
            <span style={{ marginLeft: 6, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, fontSize: '0.68rem',
              fontWeight: 700, background: 'var(--color-error)', color: 'var(--color-text-inverse)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {pendingCount}
            </span>
          )}
        </button>
        <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={() => setShowExport(true)}
          title="Download KOLs as CSV or Excel, with the columns you choose">
          <Download size={14} /> Export
        </button>
        <button className="btn btn-sm btn-outline" style={{ borderColor: '#1DA1F2', color: '#1DA1F2' }}
          onClick={() => setShowScrape(true)}>
          <Search size={14} /> Scrape data
        </button>
      </div>

      {view === 'pending' ? (
        <PendingPanel isAdmin={isAdmin}
          onChanged={() => { refreshPending(); fetchKOLs(); fetchFacets(); }}
          onNotice={(text, level) => setNotice({ text, level: level || 'error' })} />
      ) : (
      <>
      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-icon primary"><Users size={20} /></div>
          <div className="stat-label">Total KOLs</div>
          <div className="stat-value">{facets.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon info"><Globe2 size={20} /></div>
          <div className="stat-label">Countries</div>
          <div className="stat-value">{facets.geographic_zones.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon warning"><Building2 size={20} /></div>
          <div className="stat-label">Institutions</div>
          <div className="stat-value">{facets.institutions.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success"><Filter size={20} /></div>
          <div className="stat-label">Matching Filters</div>
          <div className="stat-value">{total}</div>
        </div>
      </div>

      {/* ── Filters: one row of dropdowns ── */}
      <div className="card" style={{ padding: '10px 12px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingRight: 4 }}>
            <SlidersHorizontal size={15} style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>Filters</span>
          </div>
          {/* A facet with no values renders nothing, so the row only shows
              fields that actually have data. */}
          {FACET_CONFIG.map(([key, title, icon, param]) => (
            <FacetSelect key={key} title={title} icon={icon}
              values={facets[key]} selected={selected[param] || ''}
              onSelect={v => pick(param, v)} />
          ))}
          <FacetSelect title="Source" icon={ClipboardCheck}
            values={Object.entries(SOURCE_LABELS).map(([key, cfg]) => ({ value: key, label: cfg.label }))}
            selected={source} onSelect={setSource} />
          {activeFilters.length > 0 && (
            <button onClick={clearFilters} className="btn btn-sm btn-ghost"
              style={{ flexShrink: 0, color: 'var(--color-primary)', fontSize: '0.78rem' }}>
              Clear all
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
          <input className="form-control" style={{ paddingLeft: 36 }}
            placeholder="Search name, email, contact, institution, specialty..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          {[['list', List, 'List'], ['charts', BarChart3, 'Charts']].map(([d, Icon, label]) => (
            <button key={d} className={`btn btn-sm ${display === d ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: 0 }} onClick={() => setDisplay(d)}
              title={d === 'charts' ? 'Top KOLs and how the directory breaks down' : 'KOL list'}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {display === 'list' && (
          <select className="form-control" style={{ width: 160 }} value={sort} onChange={e => setSort(e.target.value)}>
            <option value="recent">Newest first</option>
            <option value="name">Name (A–Z)</option>
          </select>
        )}
        {missingDetails.length > 0 && (
          <button className="btn btn-outline" onClick={handleFetchAllDetails} disabled={bulkBusy}
            title="Fetch publications, clinical trials and guideline authorship for the KOLs on this page">
            {bulkBusy ? <Loader size={16} className="spinning" /> : <FileSearch size={16} />}
            {' '}Fetch details ({missingDetails.length})
          </button>
        )}
        {(expTotal > 0 || expRunning) && (
          <div style={{ position: 'relative' }}>
            <button className="btn btn-outline" onClick={() => setExpPanel(v => !v)} disabled={expRunning}
              title="Fill in total experience for KOLs saved without it">
              {expRunning ? <Loader size={16} className="spinning" /> : <Hourglass size={16} />}
              {' '}{expRunning ? 'Fetching experience…' : `Fetch experience (${expTotal})`}
            </button>
            {expPanel && (
              <div className="card" style={{
                position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: 320, padding: 14,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}>
                <div style={{ fontSize: '0.84rem', marginBottom: 8 }}>
                  <strong>{expTotal}</strong> KOL{expTotal === 1 ? '' : 's'} have no total experience
                  ({expMissing.directory} in the directory, {expMissing.pending} pending).
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                  Checks their saved text, Practo profile and the page they were found on. Nothing is
                  guessed — KOLs whose experience isn't stated anywhere stay blank.
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.8rem', cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={expUseSearch} onChange={e => setExpUseSearch(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>Also search the web for each doctor's Practo profile
                    <span style={{ color: 'var(--color-text-light)' }}> — finds more, but uses about {expTotal} SerpAPI search{expTotal === 1 ? '' : 'es'}.</span>
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setExpPanel(false)}>Cancel</button>
                  <button className="btn btn-sm btn-primary" onClick={handleFetchExperience}>Start</button>
                </div>
              </div>
            )}
          </div>
        )}
        <button className="btn btn-outline" onClick={() => setShowCtri(true)}
          title="Add CTRI trials (and missing contact details) to KOLs already in the directory">
          <ClipboardList size={16} /> Update from CTRI
        </button>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={16} /> Add KOL
        </button>
      </div>

      {activeFilters.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {activeFilters.map((f, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 10px',
              borderRadius: 999, fontSize: '0.78rem', fontWeight: 500,
              background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
            }}>
              {f.label}
              <button onClick={f.clear} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 2, color: 'inherit' }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {display === 'charts' ? (
        <KOLInsights
          filters={{
            search: debouncedSearch || undefined,
            source: source || undefined,
            ...Object.fromEntries(Object.entries(selected).filter(([, v]) => v)),
          }}
          onOpen={(id) => navigate(`/kols/${id}`)}
          onNotice={insightsNotice} />
      ) : loading ? (
        <div className="loading-container"><div className="spinner"></div><p>Loading KOLs...</p></div>
      ) : kols.length === 0 ? (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--color-primary-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <Users size={28} style={{ color: 'var(--color-primary)' }} />
          </div>
          {facets.total === 0 ? (
            <>
              <h3 style={{ marginBottom: 6 }}>No KOLs Yet</h3>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                Add your first KOL, or promote an existing HCP from their profile page.
              </p>
              <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
                <Plus size={16} /> Add KOL
              </button>
            </>
          ) : (
            <>
              <h3 style={{ marginBottom: 6 }}>No Matches</h3>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                No KOLs match the current filters.
              </p>
              <button className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, minHeight: 32, flexWrap: 'wrap',
          }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
              fontSize: '0.82rem', color: 'var(--color-text-secondary)', userSelect: 'none' }}>
              <input type="checkbox" checked={allOnPageChecked} onChange={toggleCheckPage}
                style={{ width: 15, height: 15, cursor: 'pointer' }} />
              Select page
            </label>
            {checkedIds.size > 0 && (
              <>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)' }}>
                  {checkedIds.size} selected
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => setCheckedIds(new Set())}>
                  Clear
                </button>
                <button className="btn btn-sm" onClick={handleBulkDelete} disabled={deletingBulk}
                  style={{ marginLeft: 'auto', background: 'var(--color-error)', color: 'var(--color-text-inverse)', border: 'none' }}>
                  {deletingBulk ? <Loader size={14} className="spinning" /> : <Trash2 size={14} />}
                  {' '}Delete selected ({checkedIds.size})
                </button>
              </>
            )}
          </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {kols.map((kol, i) => {
                  const { initials, colors } = avatarFor(kol);
                  const [bg, fg] = colors;
                  const src = SOURCE_LABELS[kol.source] || SOURCE_LABELS.manual;
                  const inf = INFLUENCE_STYLE[kol.influence_level];
                  const name = kolName(kol, 'Unnamed');
                  const spec = [kol.specialty || kol.therapeutic_area, kol.subspecialty].filter(Boolean).join(' · ');
                  const place = [kol.state_city, kol.geographic_zone].filter(Boolean).join(', ');
                  const isChecked = checkedIds.has(kol.id);
                  const meta = (Icon, text) => (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <Icon size={11} style={{ flexShrink: 0 }} /> {text}
                    </span>
                  );
                  const open = () => navigate(`/kols/${kol.id}`);

                  return (
                    <div key={kol.id} role="link" tabIndex={0} onClick={open}
                      onKeyDown={e => { if (e.key === 'Enter') open(); }}
                      style={{
                        padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                        borderTop: i ? '1px solid var(--color-border-light)' : 'none',
                        background: isChecked ? 'var(--color-primary-bg)' : 'transparent',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = 'var(--color-bg)'; }}
                      onMouseLeave={e => { if (!isChecked) e.currentTarget.style.background = 'transparent'; }}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleChecked(kol.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${name}`} title="Select for bulk delete"
                        style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }} />
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: bg, color: fg, fontWeight: 700, fontSize: '0.8rem',
                      }}>
                        {initials}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--color-text)' }}>{name}</span>
                          {inf && (
                            <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, background: inf.bg, color: inf.color }}>
                              {kol.influence_level}
                            </span>
                          )}
                          <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, background: src.bg, color: src.color }}>
                            {src.short}
                          </span>
                          {kol.experience_years != null && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Briefcase size={10} /> {kol.experience_years} yrs
                            </span>
                          )}
                        </div>
                        {(kol.designation || kol.institution) && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {[kol.designation, kol.institution].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-light)', flexWrap: 'wrap' }}>
                          {spec && meta(BadgeCheck, spec)}
                          {place && meta(MapPin, place)}
                          {kol.email && meta(Mail, kol.email)}
                          {kol.contact_no && meta(Phone, kol.contact_no)}
                          {kol.ctri?.trial_count > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-violet)' }}>
                              <ClipboardList size={10} /> {kol.ctri.trial_count} CTRI trial{kol.ctri.trial_count === 1 ? '' : 's'}
                            </span>
                          )}
                          {kol.enrichment_status === 'running' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-info)' }}>
                              <Loader size={10} className="spinning" /> fetching publications…
                            </span>
                          )}
                          {kol.enrichment_status === 'done' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-success-text)' }}>
                              <FileText size={10} /> {kol.enrichment?.pubmed?.total_count ?? 0} pubs
                              <FlaskConical size={10} style={{ marginLeft: 6 }} /> {kol.enrichment?.clinical_trials?.total_count ?? 0} trials
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}
                        onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-ghost" title="Edit"
                          onClick={() => { setEditing(kol); setShowForm(true); }}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-sm btn-ghost" title="Remove"
                          onClick={() => handleDelete(kol)}
                          style={{ color: 'var(--color-text-light)' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                          <Trash2 size={13} />
                        </button>
                        <ChevronRight size={16} style={{ color: 'var(--color-text-light)', marginLeft: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

          <Pagination currentPage={page} totalItems={total} pageSize={pageSize}
            onPageChange={setPage} onPageSizeChange={n => { setPageSize(n); setPage(1); }} />
        </>
      )}
      </>
      )}

      {showForm && (
        <KOLFormModal kol={editing} facets={facets}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={handleSaved} />
      )}

      {showCtri && (
        <CTRIBulkModal
          defaultKeyword={selected.specialty || selected.therapeutic_area || ''}
          selectedIds={[...checkedIds]}
          onClose={() => setShowCtri(false)}
          onStarted={(r) => {
            setShowCtri(false);
            setNotice({
              text: r.checked
                ? `CTRI: ${r.trials} trial${r.trials === 1 ? '' : 's'} matched — reading investigators of the newest ${r.checked} and matching them to ${r.kols} KOL${r.kols === 1 ? '' : 's'} in the background. Rows update in a minute or two.`
                : 'CTRI found no trials for that keyword.',
              level: 'success',
            });
            if (r.checked) {
              setTimeout(() => fetchKOLs(true), 30000);
              setTimeout(() => fetchKOLs(true), 90000);
            }
          }}
        />
      )}

      {showExport && (
        <KOLExportModal
          view={view}
          total={total}
          pendingCount={pendingCount}
          selectedIds={[...checkedIds]}
          filters={{
            search: debouncedSearch || undefined,
            source: source || undefined,
            sort,
            ...Object.fromEntries(Object.entries(selected).filter(([, v]) => v)),
          }}
          onClose={() => setShowExport(false)}
        />
      )}

      {showScrape && (
        <ScrapeModal
          initialCriteria={{
            // Left blank rather than defaulted: the modal falls back to the first
            // configured therapeutic area, so nothing is pinned to one specialty.
            therapeutic_area: selected.therapeutic_area || '',
            geographic_zone: selected.geographic_zone || '',
            specialty: selected.specialty || '',
            institution: selected.institution || '',
          }}
          onClose={() => setShowScrape(false)}
          onSubmitted={(res) => {
            setShowScrape(false);
            setNotice({
              text: `${res.submitted} sent for approval${res.skipped ? `, ${res.skipped} skipped (already known)` : ''}`
                + (res.submitted ? ' — fetching publications & trials now.' : '.'),
              level: 'success',
            });
            setView('pending');
            refreshPending();
          }}
        />
      )}
    </>
  );
}
