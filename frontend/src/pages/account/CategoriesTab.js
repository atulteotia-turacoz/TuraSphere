import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Edit2, Trash2, X, RefreshCw, ToggleLeft, ToggleRight,
  Building2, Target, MapPin, DollarSign, Globe, Tag,
} from 'lucide-react';
import {
  listMyCategories, createMyCategory, updateMyCategory,
  toggleMyCategory, deleteMyCategory, getMasterData,
} from '../../services/api';

const TYPE_DEFS = [
  { type: 'pharma_sponsor',  label: 'Client / Pharma Sponsor', icon: Building2, hint: 'Companies you run advisory boards for.' },
  { type: 'therapeutic_area', label: 'Therapeutic Area',        icon: Target,    hint: 'Disease areas (Dermatology, Oncology, …). Add the supporting keywords with each one — they are what the KOL scrape actually searches for.' },
  { type: 'region',          label: 'Region',                   icon: MapPin,    hint: 'Geographies (APAC, EU, NA, …).' },
  { type: 'currency',        label: 'Currency',                 icon: DollarSign, hint: 'Codes shown on cost estimates (USD, EUR, …).' },
];
const TYPE_KEYS = TYPE_DEFS.map((t) => t.type);

// Types whose items carry supporting search terms for the KOL scrape. Only the
// therapeutic area drives that search today, so only it shows the keywords box.
const SUPPORTS_KEYWORDS = ['therapeutic_area'];

// Sub-tab is encoded as the second segment of the URL hash: "#categories/<type>".
const subTypeFromHash = () => {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  const sub = h.split('/')[1];
  return TYPE_KEYS.includes(sub) ? sub : TYPE_DEFS[0].type;
};

export default function CategoriesTab({ onNotice }) {
  const [activeType, setActiveTypeState] = useState(subTypeFromHash);
  const setActiveType = (next) => {
    setActiveTypeState(next);
    if (typeof window !== 'undefined') {
      const current = window.location.hash.replace(/^#/, '');
      const top = current.split('/')[0] || 'categories';
      window.history.replaceState(null, '', `#${top}/${next}`);
    }
  };
  useEffect(() => {
    const onHash = () => setActiveTypeState(subTypeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // When the parent first mounts CategoriesTab, make sure the hash reflects the
  // resolved sub-tab so the URL is shareable / refresh-stable from the start.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const current = window.location.hash.replace(/^#/, '');
    if (current === 'categories') {
      window.history.replaceState(null, '', `#categories/${activeType}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [items, setItems] = useState([]);          // caller's own
  const [globals, setGlobals] = useState([]);      // shared / read-only
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ label: '', value: '', keywords: '', is_active: true });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [mineRes, activeRes] = await Promise.all([
        listMyCategories(activeType),
        getMasterData(activeType),
      ]);
      setItems(mineRes.data || []);
      setGlobals((activeRes.data || []).filter((r) => r.is_global));
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, [activeType]);

  useEffect(() => { refresh(); }, [refresh]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ label: '', value: '', keywords: '', is_active: true });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ label: '', value: '', keywords: '', is_active: true });
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      label: item.label, value: item.value,
      keywords: item.keywords || '', is_active: item.is_active,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.label.trim()) { setError('Label is required'); return; }
    setSaving(true); setError('');
    try {
      if (editingId) {
        await updateMyCategory(editingId, {
          label: form.label.trim(),
          value: form.value.trim() || undefined,
          // Always sent (not `|| undefined`) so clearing the box actually clears it.
          ...(SUPPORTS_KEYWORDS.includes(activeType) ? { keywords: form.keywords } : {}),
          is_active: form.is_active,
        });
        onNotice?.('success', 'Category updated');
      } else {
        await createMyCategory({
          type: activeType,
          label: form.label.trim(),
          value: form.value.trim() || undefined,
          ...(SUPPORTS_KEYWORDS.includes(activeType) ? { keywords: form.keywords } : {}),
          is_active: form.is_active,
        });
        onNotice?.('success', 'Category added');
      }
      closeForm();
      refresh();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save category');
    } finally { setSaving(false); }
  };

  const handleToggle = async (item) => {
    try {
      await toggleMyCategory(item.id);
      refresh();
    } catch (err) {
      onNotice?.('error', err.response?.data?.detail || 'Failed to toggle');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteMyCategory(id);
      onNotice?.('success', 'Category deleted');
      setDeleteConfirm(null);
      refresh();
    } catch (err) {
      onNotice?.('error', err.response?.data?.detail || 'Failed to delete');
    }
  };

  const activeDef = useMemo(() => TYPE_DEFS.find((t) => t.type === activeType), [activeType]);
  const ActiveIcon = activeDef?.icon || Tag;

  return (
    <>
      <div className="account-card">
        <div className="account-card-header">
          <h3><Tag size={20} /> Categories</h3>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} /> Add {activeDef?.label}
          </button>
        </div>

        <div className="account-card-body">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginBottom: 16 }}>
            Manage the dropdown options used on the Advisory Boards page. Built-in options (shared with all users) are read-only;
            additions you make here appear only in your own account.
          </p>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
            {TYPE_DEFS.map((t) => {
              const Icon = t.icon;
              const isActive = t.type === activeType;
              return (
                <button
                  key={t.type}
                  onClick={() => setActiveType(t.type)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, fontSize: '0.85rem', fontWeight: 600,
                    border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text)',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              <RefreshCw size={20} className="spinning" />
            </div>
          ) : (
            <>
              {error && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  <X size={14} /> {error}
                </div>
              )}

              {/* Built-in (global) section */}
              {globals.length > 0 && (
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Globe size={14} style={{ color: 'var(--color-text-light)' }} />
                    <strong style={{ fontSize: '0.85rem' }}>Built-in</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                      {globals.length} shared option{globals.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {globals.map((g) => (
                      <span key={g.id} style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: '0.82rem',
                        background: 'var(--color-bg-secondary, var(--color-bg))',
                        color: 'var(--color-text-secondary)',
                        border: '1px solid var(--color-border-light)',
                      }}>
                        {g.label}{g.value !== g.label && <span style={{ color: 'var(--color-text-light)', marginLeft: 4 }}>· {g.value}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* User's own section */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <ActiveIcon size={14} style={{ color: 'var(--color-primary)' }} />
                <strong style={{ fontSize: '0.85rem' }}>Your {activeDef?.label || 'items'}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              </div>

              {items.length === 0 ? (
                <div style={{
                  padding: 26, textAlign: 'center', borderRadius: 8,
                  border: '1px dashed var(--color-border-light)',
                  color: 'var(--color-text-secondary)',
                }}>
                  No custom {activeDef?.label.toLowerCase()} yet.
                  <button className="btn btn-sm btn-outline" style={{ marginLeft: 10 }} onClick={openCreate}>
                    <Plus size={13} /> Add the first one
                  </button>
                </div>
              ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary, var(--color-bg))' }}>
                        <Th>Label</Th>
                        <Th>Value</Th>
                        {SUPPORTS_KEYWORDS.includes(activeType) && <Th>Keywords</Th>}
                        <Th>Status</Th>
                        <Th align="right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                          <Td><strong>{it.label}</strong></Td>
                          <Td><code style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>{it.value}</code></Td>
                          {SUPPORTS_KEYWORDS.includes(activeType) && (
                            <Td>
                              {(it.keyword_list || []).length > 0 ? (
                                <span title={(it.keyword_list || []).join('\n')}
                                  style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                                  {it.keyword_list.length} term{it.keyword_list.length === 1 ? '' : 's'}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
                                  label only
                                </span>
                              )}
                            </Td>
                          )}
                          <Td>
                            <button
                              onClick={() => handleToggle(it)}
                              title={it.is_active ? 'Click to deactivate' : 'Click to activate'}
                              style={{
                                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                color: it.is_active ? 'var(--color-success, var(--color-success))' : 'var(--color-text-light)',
                                fontWeight: 600, fontSize: '0.82rem',
                              }}
                            >
                              {it.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                              {it.is_active ? 'Active' : 'Inactive'}
                            </button>
                          </Td>
                          <Td align="right">
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              <button className="btn btn-sm btn-ghost" onClick={() => openEdit(it)} title="Edit">
                                <Edit2 size={13} />
                              </button>
                              {deleteConfirm === it.id ? (
                                <>
                                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(it.id)}>Yes</button>
                                  <button className="btn btn-sm btn-ghost" onClick={() => setDeleteConfirm(null)}>No</button>
                                </>
                              ) : (
                                <button className="btn btn-sm btn-ghost"
                                  style={{ color: 'var(--color-error)' }}
                                  onClick={() => setDeleteConfirm(it.id)} title="Delete">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h3>{editingId ? 'Edit' : 'Add'} {activeDef?.label}</h3>
              <button className="modal-close" onClick={closeForm}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {activeDef?.hint && (
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
                  {activeDef.hint}
                </p>
              )}
              <div className="form-group">
                <label>Label *</label>
                <input
                  className="form-control"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder={activeType === 'currency' ? 'e.g. Canadian Dollar' : 'Display name'}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>
                  Value <small style={{ color: 'var(--color-text-secondary)' }}>(optional — auto-derived from label)</small>
                </label>
                <input
                  className="form-control"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder={activeType === 'currency' ? 'e.g. CAD' : 'auto'}
                />
              </div>
              {SUPPORTS_KEYWORDS.includes(activeType) && (
                <div className="form-group">
                  <label>
                    Supporting keywords <small style={{ color: 'var(--color-text-secondary)' }}>(one per line)</small>
                  </label>
                  <textarea
                    className="form-control"
                    rows={7}
                    value={form.keywords}
                    onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                    placeholder={'dermatologist\ndermatology\nskin specialist\nconsultant dermatologist\nDNB dermatology'}
                    style={{ fontFamily: 'inherit', resize: 'vertical' }}
                  />
                  <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
                    Used in the background when this area is picked in Find KOLs. Doctors rarely
                    write "{form.label || 'Dermatology'}" in a bio or tweet — they say "skin specialist"
                    or "DNB dermatology". Each line is searched on X and matched against profile bios.
                    Leave empty and only the label above is searched.
                  </small>
                </div>
              )}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Active (shown in dropdowns)
              </label>
              {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeForm}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : (editingId ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const Th = ({ children, align = 'left' }) => (
  <th style={{ padding: '10px 14px', textAlign: align, fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
    {children}
  </th>
);
const Td = ({ children, align = 'left' }) => (
  <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle' }}>
    {children}
  </td>
);
