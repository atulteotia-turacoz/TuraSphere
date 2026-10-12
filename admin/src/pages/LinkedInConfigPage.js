import React, { useState, useEffect } from 'react';
import {
  Linkedin, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  RefreshCw, Star, StarOff, Wifi, WifiOff,
} from 'lucide-react';
import {
  listLinkedInConfigs, createLinkedInConfig, updateLinkedInConfig,
  deleteLinkedInConfig, testLinkedInConfig, setDefaultLinkedIn,
} from '../services/api';

const emptyForm = {
  display_name: '',
  client_id: '',
  client_secret: '',
  redirect_uri: '',
  access_token: '',
  scopes: 'r_liteprofile r_emailaddress',
  is_active: true,
  is_default: false,
  description: '',
};

export default function LinkedInConfigPage() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(null);

  const fetchConfigs = async () => {
    try {
      const res = await listLinkedInConfigs();
      setConfigs(res.data);
    } catch {
      setError('Failed to load LinkedIn configurations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfigs(); }, []);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
    setError('');
  };

  const openEdit = (cfg) => {
    setEditId(cfg.id);
    setForm({
      display_name: cfg.display_name,
      client_id: cfg.client_id || '',
      client_secret: cfg.client_secret || '',
      redirect_uri: cfg.redirect_uri || '',
      access_token: cfg.access_token || '',
      scopes: cfg.scopes || emptyForm.scopes,
      is_active: cfg.is_active,
      is_default: cfg.is_default,
      description: cfg.description || '',
    });
    setShowModal(true);
    setError('');
  };

  const handleSave = async () => {
    if (!form.display_name) { setError('Display name is required'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        await updateLinkedInConfig(editId, form);
        setSuccess('Configuration updated');
      } else {
        await createLinkedInConfig(form);
        setSuccess('Configuration created');
      }
      setShowModal(false);
      fetchConfigs();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try {
      await deleteLinkedInConfig(id);
      setSuccess('Configuration deleted');
      setDeleteConfirm(null);
      fetchConfigs();
    } catch { setError('Failed to delete'); }
  };

  const handleTest = async (id) => {
    setTesting(id); setTestResult(null);
    try {
      const res = await testLinkedInConfig(id);
      setTestResult({ id, ...res.data });
    } catch {
      setTestResult({ id, success: false, message: 'Connection test failed' });
    } finally { setTesting(null); }
  };

  const handleSetDefault = async (id) => {
    try {
      await setDefaultLinkedIn(id);
      setSuccess('Default configuration updated');
      fetchConfigs();
    } catch { setError('Failed to set default'); }
  };

  const maskSecret = (val) => {
    if (!val) return '--';
    if (val.length <= 8) return '****';
    return val.slice(0, 4) + '****' + val.slice(-4);
  };

  if (loading) return <div className="admin-page"><div className="loading-spinner"><div className="spinner" /></div></div>;

  return (
    <div className="admin-page">
      <div className="page-header-row">
        <div>
          <h1><Linkedin size={24} /> LinkedIn API Configuration</h1>
          <p className="page-subtitle">Configure LinkedIn API credentials for professional profile data scoring</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> Add Configuration
        </button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && !showModal && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

      {/* Info Card */}
      <div className="card" style={{ marginBottom: 20, background: 'var(--info-light)', border: '1px solid var(--info-light)' }}>
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--info)' }}>
            <strong>LinkedIn API:</strong> LinkedIn requires OAuth 2.0 credentials (Client ID & Client Secret) from a registered application
            on the <strong>LinkedIn Developer Portal</strong>. The API is used to enrich HCP profiles with professional data such as
            endorsements, connections, and professional activity for future scoring parameters.
          </p>
        </div>
      </div>

      {configs.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
            <Linkedin size={48} style={{ color: 'var(--border-strong)', marginBottom: 12 }} />
            <h3>No LinkedIn Configuration</h3>
            <p>Add a configuration to enable LinkedIn profile data enrichment.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openCreate}>
              <Plus size={16} /> Add Configuration
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {configs.map((cfg) => (
            <div key={cfg.id} className="card">
              <div className="card-body" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <h3 style={{ margin: 0 }}>{cfg.display_name}</h3>
                      {cfg.is_default && (
                        <span className="badge badge-primary" style={{ fontSize: '0.72rem' }}>
                          <Star size={10} style={{ marginRight: 3 }} /> Default
                        </span>
                      )}
                      {cfg.is_active ? (
                        <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>Active</span>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>Inactive</span>
                      )}
                    </div>
                    {cfg.description && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '4px 0 12px' }}>{cfg.description}</p>
                    )}
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      <div><strong>Client ID:</strong> {maskSecret(cfg.client_id)}</div>
                      <div><strong>Client Secret:</strong> {maskSecret(cfg.client_secret)}</div>
                      <div><strong>Scopes:</strong> {cfg.scopes || '--'}</div>
                    </div>
                    {cfg.redirect_uri && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                        <strong>Redirect URI:</strong> {cfg.redirect_uri}
                      </div>
                    )}

                    {testResult && testResult.id === cfg.id && (
                      <div style={{
                        marginTop: 12, padding: '8px 14px', borderRadius: 6, fontSize: '0.85rem',
                        background: testResult.success ? 'var(--success-light)' : 'var(--danger-light)',
                        color: testResult.success ? 'var(--success)' : 'var(--danger)',
                        border: `1px solid ${testResult.success ? 'var(--success-light)' : 'var(--danger-light)'}`,
                      }}>
                        {testResult.success ? <Wifi size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> : <WifiOff size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />}
                        {testResult.message}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-sm btn-outline" onClick={() => handleTest(cfg.id)} disabled={testing === cfg.id}>
                      {testing === cfg.id ? <RefreshCw size={14} className="spinning" /> : <Wifi size={14} />} Test
                    </button>
                    {!cfg.is_default && (
                      <button className="btn btn-sm btn-outline" onClick={() => handleSetDefault(cfg.id)} title="Set as Default">
                        <StarOff size={14} />
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(cfg)}><Edit2 size={14} /></button>
                    {deleteConfirm === cfg.id ? (
                      <>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(cfg.id)}>Confirm</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--color-error, var(--danger))' }}
                        onClick={() => setDeleteConfirm(cfg.id)}><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{editId ? 'Edit LinkedIn Configuration' : 'Add LinkedIn Configuration'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertTriangle size={14} /> {error}</div>}

              <div className="form-group">
                <label>Display Name *</label>
                <input className="form-control" value={form.display_name} placeholder="e.g. LinkedIn Production"
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label>Client ID</label>
                  <input className="form-control" value={form.client_id} placeholder="LinkedIn App Client ID"
                    onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Client Secret</label>
                  <input className="form-control" type="password" value={form.client_secret} placeholder="LinkedIn App Client Secret"
                    onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label>Redirect URI</label>
                <input className="form-control" value={form.redirect_uri} placeholder="e.g. https://yourdomain.com/auth/linkedin/callback"
                  onChange={(e) => setForm({ ...form, redirect_uri: e.target.value })} />
              </div>

              <div className="form-group">
                <label>OAuth Scopes</label>
                <input className="form-control" value={form.scopes} placeholder="r_liteprofile r_emailaddress"
                  onChange={(e) => setForm({ ...form, scopes: e.target.value })} />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Space-separated list of OAuth scopes</small>
              </div>

              <div className="form-group">
                <label>Access Token (optional)</label>
                <input className="form-control" type="password" value={form.access_token} placeholder="Pre-generated access token"
                  onChange={(e) => setForm({ ...form, access_token: e.target.value })} />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>If you have a long-lived token, paste it here</small>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" rows={2} value={form.description} placeholder="Optional notes..."
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  Active
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                  Set as Default
                </label>
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
