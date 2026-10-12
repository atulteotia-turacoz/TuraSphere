import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase, Plus, Edit2, Trash2, X, Check, AlertTriangle, RefreshCw, Search,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import {
  listAdvisoryServices,
  createAdvisoryService,
  updateAdvisoryService,
  deleteAdvisoryService,
} from '../services/api';

// Mirrors backend BoardPhase enum + frontend phase order.
const PHASES = [
  { id: 'pre_meeting',     label: 'Pre-Meeting',     short: 'Pre',     color: 'var(--primary)' },
  { id: 'meeting',         label: 'Meeting',         short: 'Meeting', color: 'var(--info)' },
  { id: 'post_meeting',    label: 'Post-Meeting',    short: 'Post',    color: 'var(--success)' },
  { id: 'ongoing_support', label: 'Ongoing Support', short: 'Ongoing', color: 'var(--warning)' },
  { id: 'event_specific',  label: 'Event-Specific',  short: 'Event',   color: 'var(--tier-gold)' },
];
const PHASE_BY_ID = Object.fromEntries(PHASES.map((p) => [p.id, p]));

const FEE_UNITS = [
  { id: 'fixed',      label: 'Fixed fee' },
  { id: 'hourly',     label: 'Per hour' },
  { id: 'per_day',    label: 'Per day' },
  { id: 'per_kol',    label: 'Per KOL' },
  { id: 'per_region', label: 'Per region' },
  { id: 'per_seat',   label: 'Per participant' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'SGD', 'JPY'];

const emptyForm = {
  slug: '', name: '', description: '', fee_label: '',
  phase: 'pre_meeting', default_unit: 'fixed', default_price: 0,
  currency: 'USD', is_active: true, sort_order: 0,
};

const slugify = (s) =>
  (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '').slice(0, 80);

const fmtMoney = (n, c) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
  } catch {
    return `${c || 'USD'} ${Math.round(Number(n) || 0).toLocaleString()}`;
  }
};

export default function AdvisoryServicesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [query, setQuery] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await listAdvisoryServices({ include_inactive: true });
      setItems(r.data || []);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, []);
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 2500);
      return () => clearTimeout(t);
    }
  }, [success]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((s) => {
      if (phaseFilter !== 'all' && s.phase !== phaseFilter) return false;
      if (!q) return true;
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.slug || '').toLowerCase().includes(q) ||
        (s.fee_label || '').toLowerCase().includes(q)
      );
    });
  }, [items, phaseFilter, query]);

  const phaseCounts = useMemo(() => {
    const m = { all: items.length };
    PHASES.forEach((p) => { m[p.id] = items.filter((s) => s.phase === p.id).length; });
    return m;
  }, [items]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setFormErr('');
    setShowModal(true);
  };

  const openEdit = (s) => {
    setEditId(s.id);
    setForm({
      slug: s.slug,
      name: s.name,
      description: s.description || '',
      fee_label: s.fee_label || '',
      phase: s.phase,
      default_unit: s.default_unit,
      default_price: Number(s.default_price) || 0,
      currency: s.currency || 'USD',
      is_active: !!s.is_active,
      sort_order: Number(s.sort_order) || 0,
    });
    setFormErr('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setFormErr('Service name is required'); return; }
    if (!editId && !form.slug.trim()) { setFormErr('Slug is required'); return; }
    setSaving(true); setFormErr('');
    try {
      const payload = {
        ...form,
        slug: (form.slug || '').trim(),
        name: form.name.trim(),
        description: form.description?.trim() || null,
        fee_label: form.fee_label?.trim() || null,
        default_price: Number(form.default_price) || 0,
        sort_order: Number(form.sort_order) || 0,
      };
      if (editId) {
        // slug is immutable on update — don't send
        const { slug: _slug, ...rest } = payload;
        await updateAdvisoryService(editId, rest);
        setSuccess('Service updated');
      } else {
        await createAdvisoryService(payload);
        setSuccess('Service created');
      }
      setShowModal(false);
      fetchItems();
    } catch (e) {
      setFormErr(e.response?.data?.detail || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (svc) => {
    try {
      await updateAdvisoryService(svc.id, { is_active: !svc.is_active });
      setItems((prev) => prev.map((x) => (x.id === svc.id ? { ...x, is_active: !x.is_active } : x)));
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to toggle status');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAdvisoryService(id);
      setDeleteConfirm(null);
      setSuccess('Service deleted');
      fetchItems();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to delete');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title"><Briefcase size={24} /> Advisory Board Services</h1>
          <p className="page-subtitle">Catalog of services across each phase. End users select these when creating a board.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Add Service</button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && <div className="alert alert-danger"><AlertTriangle size={16} /> {error}</div>}

      {/* Phase filter chips + search */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <FilterPill active={phaseFilter === 'all'} onClick={() => setPhaseFilter('all')} label="All phases" color="var(--text-secondary)" count={phaseCounts.all} />
        {PHASES.map((p) => (
          <FilterPill key={p.id} active={phaseFilter === p.id} onClick={() => setPhaseFilter(p.id)} label={p.label} color={p.color} count={phaseCounts[p.id]} />
        ))}
        <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-control"
            placeholder="Search services…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Briefcase size={48} />
          <h3>No services yet</h3>
          <p>Add advisory board services so end users can select them when creating boards.</p>
          <button className="btn btn-primary mt-4" onClick={openCreate}><Plus size={16} /> Add Service</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No services match your filters.</p></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Service</th>
                <th style={{ width: '14%' }}>Phase</th>
                <th style={{ width: '14%' }}>Default unit</th>
                <th style={{ width: '14%' }}>Default price</th>
                <th style={{ width: '8%' }}>Order</th>
                <th style={{ width: '8%' }}>Status</th>
                <th style={{ width: '10%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const phase = PHASE_BY_ID[s.phase] || PHASES[0];
                const unit = FEE_UNITS.find((u) => u.id === s.default_unit)?.label || s.default_unit;
                return (
                  <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.slug}</code>
                      {s.fee_label && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{s.fee_label}</div>}
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                        background: `${phase.color}1A`, color: phase.color,
                      }}>{phase.label}</span>
                    </td>
                    <td><span style={{ fontSize: '0.85rem' }}>{unit}</span></td>
                    <td>
                      {Number(s.default_price) > 0 ? (
                        <strong>{fmtMoney(s.default_price, s.currency)}</strong>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>{s.sort_order}</td>
                    <td>
                      <span className={`badge ${s.is_active ? 'badge-success' : 'badge-danger'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-outline" onClick={() => handleToggleActive(s)} title={s.is_active ? 'Disable' : 'Enable'}>
                          {s.is_active ? <ToggleRight size={14} style={{ color: 'var(--success)' }} /> : <ToggleLeft size={14} />}
                        </button>
                        <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}><Edit2 size={14} /></button>
                        <button className="btn btn-sm btn-outline danger" onClick={() => setDeleteConfirm(s)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !saving && setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Service' : 'New Service'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {formErr && <div className="alert alert-danger mb-4"><AlertTriangle size={14} /> {formErr}</div>}

              <div className="form-group">
                <label>Service name *</label>
                <input
                  className="form-control"
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({
                      ...f,
                      name,
                      slug: editId ? f.slug : slugify(name),
                    }));
                  }}
                  placeholder="e.g. KOL Identification and Recruitment"
                />
              </div>

              <div className="form-group">
                <label>Slug {editId ? '(read-only)' : '*'}</label>
                <input
                  className="form-control"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
                  disabled={!!editId}
                  placeholder="e.g. pre_kol_recruitment"
                />
                <small style={{ color: 'var(--text-secondary)' }}>Stable identifier used by saved boards. Cannot be changed once created.</small>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Phase *</label>
                  <select
                    className="form-control"
                    value={form.phase}
                    onChange={(e) => setForm({ ...form, phase: e.target.value })}
                  >
                    {PHASES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Default unit *</label>
                  <select
                    className="form-control"
                    value={form.default_unit}
                    onChange={(e) => setForm({ ...form, default_unit: e.target.value })}
                  >
                    {FEE_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Default price</label>
                  <input
                    type="number" min="0" step="any"
                    className="form-control"
                    value={form.default_price}
                    onChange={(e) => setForm({ ...form, default_price: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select
                    className="form-control"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  >
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Fee label</label>
                <input
                  className="form-control"
                  value={form.fee_label}
                  onChange={(e) => setForm({ ...form, fee_label: e.target.value })}
                  placeholder="e.g. KOL identification and invitation fee"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-control" rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What does this service include?"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Sort order</label>
                  <input
                    type="number" min="0"
                    className="form-control"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                    <span>Active (visible to end users)</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><RefreshCw size={14} className="spinning" /> Saving…</> : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon"><AlertTriangle size={24} /></div>
              <h3>Delete service?</h3>
              <p>
                Permanently remove <strong>{deleteConfirm.name}</strong>. Any existing advisory boards that referenced
                it will keep the saved selection but will no longer find this service in the catalog.
              </p>
              <div className="confirm-actions">
                <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm.id)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({ active, onClick, label, color, count }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600,
      border: `1px solid ${active ? color : 'var(--border-color)'}`,
      background: active ? color : 'var(--text-white)', color: active ? 'var(--text-white)' : 'var(--text-secondary)',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          background: active ? 'rgba(255,255,255,0.25)' : 'var(--content-raised)',
          color: active ? 'var(--text-white)' : 'var(--text-secondary)',
          padding: '0 6px', borderRadius: 999, fontSize: '0.7rem',
        }}>{count}</span>
      )}
    </button>
  );
}
