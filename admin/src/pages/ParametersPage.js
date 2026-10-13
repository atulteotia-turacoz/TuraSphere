import React, { useState, useEffect } from 'react';
import {
  Settings, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  RefreshCw, CheckSquare, Square, Lock, UserPlus,
} from 'lucide-react';
import {
  listAssessmentParameters, createAssessmentParameter,
  updateAssessmentParameter, deleteAssessmentParameter,
} from '../services/api';

const emptyForm = {
  category: '', code: '', name: '', description: '',
  max_score: 0, score_group: '', group_max_score: '', is_active: true, sort_order: 0,
};

// Tiers of one criterion share a score group: their scores count together up
// to the group total. Ungrouped parameters count up to their own max score.
const capOf = (rows) => {
  const seen = new Set();
  return rows.reduce((sum, p) => {
    if (!p.is_active) return sum;
    if (!p.score_group) return sum + (p.max_score || 0);
    if (seen.has(p.score_group)) return sum;
    seen.add(p.score_group);
    return sum + (p.group_max_score ?? 0);
  }, 0);
};

const CATEGORIES = [
  'Selection Criteria - Qualification',
  'Selection Criteria - Experience',
  'Selection Criteria - Surgeons',
  'Selection Criteria - Publications',
  'Selection Criteria - Faculty',
  'C.1 Leadership',
  'C.2 Presentations',
  'C.3 Publications',
  'C.4 Clinical Experience',
  'C.5 Citation Velocity',
  'C.6 Network Centrality',
  'C.7 Patient Impact',
  'C.8 Guideline Authority',
  'C.9 Emerging Leader',
  'C.10 Practo Patient Influence',
  'Medical registration number',
  'Government organisation',
];

export default function ParametersPage() {
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');

  const fetchParams = async () => {
    try {
      const res = await listAssessmentParameters();
      setParameters(res.data);
    } catch (err) {
      setError('Failed to load parameters');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchParams(); }, []);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
    setError('');
  };

  const openEdit = (param) => {
    setEditId(param.id);
    setForm({
      category: param.category,
      code: param.code,
      name: param.name,
      description: param.description || '',
      max_score: param.max_score,
      score_group: param.score_group || '',
      group_max_score: param.group_max_score ?? '',
      is_active: param.is_active,
      sort_order: param.sort_order,
    });
    setShowModal(true);
    setError('');
  };

  const handleSave = async () => {
    if (!form.category || !form.code || !form.name) {
      setError('Category, Code, and Name are required');
      return;
    }
    if (form.score_group && form.group_max_score === '') {
      setError('Group Total is required when a Score Group is set');
      return;
    }
    setSaving(true); setError('');
    const payload = {
      ...form,
      score_group: form.score_group.trim() || null,
      group_max_score: form.score_group.trim() && form.group_max_score !== '' ? Number(form.group_max_score) : null,
    };
    try {
      if (editId) {
        await updateAssessmentParameter(editId, payload);
        setSuccess('Parameter updated successfully');
      } else {
        await createAssessmentParameter(payload);
        setSuccess('Parameter created successfully');
      }
      setShowModal(false);
      fetchParams();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save parameter');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAssessmentParameter(id);
      setSuccess('Parameter deleted');
      setDeleteConfirm(null);
      fetchParams();
    } catch (err) {
      setError('Failed to delete parameter');
    }
  };

  const filteredParams = filterCategory
    ? parameters.filter((p) => p.category === filterCategory)
    : parameters;

  const categories = [...new Set(parameters.map((p) => p.category))];

  // "Total" cell: a run of rows in the same score group shares one merged cell.
  const groupSpan = (i) => {
    const g = filteredParams[i].score_group;
    if (!g) return 1;
    if (i > 0 && filteredParams[i - 1].score_group === g) return 0;
    let n = 1;
    while (i + n < filteredParams.length && filteredParams[i + n].score_group === g) n += 1;
    return n;
  };
  const standardTotal = capOf(parameters.filter((p) => p.is_standard));

  if (loading) return <div className="admin-page"><div className="loading-spinner"><div className="spinner" /></div></div>;

  return (
    <div className="admin-page">
      <div className="page-header-row">
        <div>
          <h1><Settings size={24} /> Assessment Parameters</h1>
          <p className="page-subtitle">
            Manage KOL assessment criteria and scoring parameters — standard assessment is out of <strong>{standardTotal}</strong>
          </p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> Add Parameter
        </button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && !showModal && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

      {/* Category Filter */}
      <div style={{ marginBottom: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${!filterCategory ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setFilterCategory('')}
        >
          All ({parameters.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`btn btn-sm ${filterCategory === cat ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilterCategory(cat)}
          >
            {cat} ({parameters.filter((p) => p.category === cat).length})
          </button>
        ))}
      </div>

      {/* Parameters Table */}
      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Code</th>
                <th>Name</th>
                <th>Max Score</th>
                <th>Total</th>
                <th>Order</th>
                <th>Type</th>
                <th>Created By</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredParams.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>
                    No parameters found
                  </td>
                </tr>
              ) : (
                filteredParams.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{p.category}</span>
                    </td>
                    <td><code style={{ fontSize: '0.8rem' }}>{p.code}</code></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.name}</div>
                      {p.description && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                          {p.description.length > 80 ? p.description.slice(0, 80) + '...' : p.description}
                        </div>
                      )}
                    </td>
                    <td><strong>{p.max_score}</strong></td>
                    {groupSpan(i) > 0 && (
                      <td rowSpan={groupSpan(i)} style={{ verticalAlign: 'middle', textAlign: 'center' }}
                        title={p.score_group ? `Group ${p.score_group}: these tiers count together up to ${p.group_max_score}` : undefined}>
                        <strong>{p.score_group ? p.group_max_score : p.max_score}</strong>
                        {p.score_group && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>{p.score_group}</div>
                        )}
                      </td>
                    )}
                    <td>{p.sort_order}</td>
                    <td>
                      {p.is_standard ? (
                        <span className="badge badge-primary" style={{ fontSize: '0.72rem' }}><Lock size={10} style={{ marginRight: 3 }} />Standard</span>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}><UserPlus size={10} style={{ marginRight: 3 }} />Custom</span>
                      )}
                    </td>
                    <td>
                      {p.is_standard ? (
                        <span style={{ color: 'var(--color-text-light)', fontSize: '0.82rem' }}>System</span>
                      ) : p.created_by_name ? (
                        <span style={{ fontSize: '0.82rem' }}>{p.created_by_name}</span>
                      ) : (
                        <span style={{ color: 'var(--color-text-light)', fontSize: '0.82rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      {p.is_active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-warning">Inactive</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => openEdit(p)} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        {deleteConfirm === p.id ? (
                          <>
                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)}>Confirm</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--color-error)' }}
                            onClick={() => setDeleteConfirm(p.id)} title="Delete">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {filteredParams.length > 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'right' }}><strong>TOTAL</strong></td>
                  <td style={{ textAlign: 'center' }}><strong>{capOf(filteredParams)}</strong></td>
                  <td colSpan="5" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Parameter' : 'Add Parameter'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertTriangle size={14} /> {error}</div>}

              <div className="form-group">
                <label>Category *</label>
                <select className="form-control" value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">Select category...</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__custom">Custom category...</option>
                </select>
              </div>
              {form.category === '__custom' && (
                <div className="form-group">
                  <label>Custom Category Name *</label>
                  <input className="form-control" placeholder="Enter custom category"
                    onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
              )}

              <div className="form-group">
                <label>Code * <small style={{ color: 'var(--color-text-secondary)' }}>(unique identifier, e.g. C1_BOARD_MEMBER)</small></label>
                <input className="form-control" value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
              </div>

              <div className="form-group">
                <label>Name *</label>
                <input className="form-control" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" rows={3} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Max Score</label>
                  <input className="form-control" type="number" step="0.5" min="0" value={form.max_score}
                    onChange={(e) => setForm({ ...form, max_score: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Score Group <small style={{ color: 'var(--color-text-secondary)' }}>(optional)</small></label>
                  <input className="form-control" placeholder="e.g. C2_SPEAKING" value={form.score_group}
                    onChange={(e) => setForm({ ...form, score_group: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Group Total</label>
                  <input className="form-control" type="number" step="0.5" min="0" value={form.group_max_score}
                    disabled={!form.score_group}
                    onChange={(e) => setForm({ ...form, group_max_score: e.target.value })} />
                </div>
              </div>
              <small style={{ display: 'block', marginTop: -8, marginBottom: 12, color: 'var(--color-text-secondary)' }}>
                Parameters with the same Score Group count together, up to the Group Total.
              </small>

              <div style={{ display: 'flex', gap: 16 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Sort Order</label>
                  <input className="form-control" type="number" min="0" value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                >
                  {form.is_active ? (
                    <CheckSquare size={18} style={{ color: 'var(--color-primary)' }} />
                  ) : (
                    <Square size={18} style={{ color: 'var(--color-text-light)' }} />
                  )}
                  <span>Active</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
