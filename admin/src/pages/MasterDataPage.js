import React, { useState, useEffect } from 'react';
import {
  Layers, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  RefreshCw, ToggleLeft, ToggleRight, Stethoscope, HeartPulse, UserCheck,
} from 'lucide-react';
import {
  listMasterData, createMasterData, updateMasterData, deleteMasterData, toggleMasterData,
} from '../services/api';

const TABS = [
  { key: 'therapeutic_area', label: 'Therapeutic Area', icon: HeartPulse },
  { key: 'specialty', label: 'Specialty', icon: Stethoscope },
  { key: 'hcp_type', label: 'HCP Type', icon: UserCheck },
];

const emptyForm = { label: '', value: '', sort_order: 0, is_active: true };

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState('therapeutic_area');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await listMasterData({ type: activeTab });
      setItems(res.data);
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, [activeTab]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const generateValue = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setError('');
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditId(item.id);
    setForm({
      label: item.label,
      value: item.value,
      sort_order: item.sort_order,
      is_active: item.is_active,
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.label.trim()) { setError('Label is required'); return; }
    if (!form.value.trim()) { setError('Value is required'); return; }
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await updateMasterData(editId, form);
        setSuccess('Item updated successfully');
      } else {
        await createMasterData({ ...form, type: activeTab });
        setSuccess('Item created successfully');
      }
      setShowModal(false);
      fetchItems();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      await toggleMasterData(id);
      fetchItems();
    } catch {
      setError('Failed to toggle status');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteMasterData(id);
      setDeleteConfirm(null);
      setSuccess('Item deleted');
      fetchItems();
    } catch {
      setError('Failed to delete');
    }
  };

  const tabLabel = TABS.find((t) => t.key === activeTab)?.label || '';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title"><Layers size={24} /> Master Data</h1>
          <p className="page-subtitle">Manage dropdown options for Therapeutic Area, Specialty, and HCP Type</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Add {tabLabel}</button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && !showModal && <div className="alert alert-danger"><AlertTriangle size={16} /> {error}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border-color)' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 20px',
                border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: '-2px',
                fontSize: '0.9rem',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} /> {tab.label}
              <span style={{
                background: isActive ? 'var(--primary-light)' : 'var(--content-raised)',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: '0.72rem', fontWeight: 600,
                padding: '1px 8px', borderRadius: 10,
              }}>
                {items.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Layers size={48} />
          <h3>No {tabLabel} Items</h3>
          <p>Create items that will appear in dropdowns on the assessment form.</p>
          <button className="btn btn-primary mt-4" onClick={openCreate}><Plus size={16} /> Add {tabLabel}</button>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '30%' }}>Label</th>
                <th style={{ width: '25%' }}>Value</th>
                <th style={{ width: '10%' }}>Order</th>
                <th style={{ width: '12%' }}>Status</th>
                <th style={{ width: '18%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.55 }}>
                  <td>{idx + 1}</td>
                  <td style={{ fontWeight: 500 }}>{item.label}</td>
                  <td><code style={{ fontSize: '0.82rem', background: 'var(--content-raised)', padding: '2px 8px', borderRadius: 4 }}>{item.value}</code></td>
                  <td>{item.sort_order}</td>
                  <td>
                    <span className={`badge ${item.is_active ? 'badge-success' : 'badge-danger'}`}>
                      {item.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleToggle(item.id)}
                        title={item.is_active ? 'Disable' : 'Enable'}
                      >
                        {item.is_active ? <ToggleRight size={14} style={{ color: 'var(--success)' }} /> : <ToggleLeft size={14} />}
                      </button>
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(item)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn btn-sm btn-outline danger" onClick={() => setDeleteConfirm(item.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? `Edit ${tabLabel}` : `Add New ${tabLabel}`}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger mb-4"><AlertTriangle size={14} /> {error}</div>}

              <div className="form-group">
                <label>Display Label *</label>
                <input
                  className="form-control"
                  value={form.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setForm({
                      ...form,
                      label,
                      value: editId ? form.value : generateValue(label),
                    });
                  }}
                  placeholder={`e.g. ${activeTab === 'hcp_type' ? 'Surgeon' : activeTab === 'specialty' ? 'Cardiology' : 'Oncology'}`}
                />
              </div>

              <div className="form-group">
                <label>Stored Value *</label>
                <input
                  className="form-control"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="auto-generated from label"
                />
                <small style={{ color: 'var(--text-secondary)' }}>This value is stored in the database. Use lowercase with underscores.</small>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Sort Order</label>
                  <input
                    className="form-control"
                    type="number"
                    min="0"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                    <span>Active (visible in dropdowns)</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon"><AlertTriangle size={24} /></div>
              <h3>Delete Item?</h3>
              <p>This will permanently remove this {tabLabel.toLowerCase()} option. Existing HCP records using this value will not be affected.</p>
              <div className="confirm-actions">
                <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
