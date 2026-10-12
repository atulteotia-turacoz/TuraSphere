import React, { useState, useEffect } from 'react';
import {
  Globe, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  RefreshCw, Star, StarOff, Wifi, WifiOff,
} from 'lucide-react';
import {
  listWSConfigs, createWSConfig, updateWSConfig,
  deleteWSConfig, testWSConfig, setDefaultWS,
} from '../services/api';
import SearchUsagePanel from '../components/SearchUsagePanel';

const emptyForm = {
  display_name: '',
  provider: 'serpapi',
  api_key: '',
  is_active: true,
  is_default: false,
  description: '',
};

// SerpAPI keys for the Find KOLs "Google search" method (super admin only).
export default function WebSearchConfigPage() {
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
      const res = await listWSConfigs();
      setConfigs(res.data);
    } catch (err) {
      setError(err.response?.status === 403
        ? 'Only a super admin can manage Google search keys'
        : 'Failed to load Google search configurations');
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
    setForm({ ...emptyForm, is_default: configs.length === 0 });
    setShowModal(true);
    setError('');
  };

  const openEdit = (cfg) => {
    setEditId(cfg.id);
    setForm({
      display_name: cfg.display_name,
      provider: cfg.provider || 'serpapi',
      api_key: cfg.api_key || '',
      is_active: cfg.is_active,
      is_default: cfg.is_default,
      description: cfg.description || '',
    });
    setShowModal(true);
    setError('');
  };

  const handleSave = async () => {
    if (!form.display_name) { setError('Display name is required'); return; }
    if (!form.api_key) { setError('SerpAPI key is required'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        await updateWSConfig(editId, form);
        setSuccess('Configuration updated');
      } else {
        await createWSConfig(form);
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
      await deleteWSConfig(id);
      setSuccess('Configuration deleted');
      setDeleteConfirm(null);
      fetchConfigs();
    } catch { setError('Failed to delete'); }
  };

  const handleTest = async (id) => {
    setTesting(id); setTestResult(null);
    try {
      const res = await testWSConfig(id);
      setTestResult({ id, ...res.data });
    } catch {
      setTestResult({ id, success: false, message: 'Connection test failed' });
    } finally { setTesting(null); }
  };

  const handleSetDefault = async (id) => {
    try {
      await setDefaultWS(id);
      setSuccess('Default configuration updated');
      fetchConfigs();
    } catch { setError('Failed to set default'); }
  };

  if (loading) return <div className="admin-page"><div className="loading-spinner"><div className="spinner" /></div></div>;

  return (
    <div className="admin-page">
      <div className="page-header-row">
        <div>
          <h1><Globe size={24} /> Google Search Configuration</h1>
          <p className="page-subtitle">SerpAPI keys for the Google search method in Find KOLs</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> Add Key
        </button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && !showModal && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

      <div className="card" style={{ marginBottom: 20, background: 'var(--tier-platinum-bg)', border: '1px solid var(--tier-platinum-bg)' }}>
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--tier-platinum)' }}>
            <strong>How it runs:</strong> every <strong>active</strong> key is tried in order, the default first.
            When a key is invalid or has used up its searches, the next key is used. With no key left,
            the search <strong>falls back to free Brave / DuckDuckGo</strong> results, so Find KOLs keeps working.
            Get keys from{' '}
            <a href="https://serpapi.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tier-platinum)' }}>
              serpapi.com
            </a>. Use <strong>Test</strong> to see how many searches a key has left.
          </p>
        </div>
      </div>

      {!loading && <SearchUsagePanel />}

      {configs.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
            <Globe size={48} style={{ color: 'var(--border-strong)', marginBottom: 12 }} />
            <h3>No SerpAPI Key</h3>
            <p>Google search in Find KOLs is using the free fallback. Add a key for real Google results.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openCreate}>
              <Plus size={16} /> Add Key
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
                      <span style={{
                        fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10,
                        background: 'var(--info-light)', color: 'var(--info)', fontWeight: 500,
                      }}>
                        SerpAPI
                      </span>
                    </div>
                    {cfg.description && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '4px 0 12px' }}>{cfg.description}</p>
                    )}
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      <strong>API Key:</strong>{' '}
                      {cfg.api_key ? `${cfg.api_key.slice(0, 8)}...` : <span style={{ color: 'var(--danger)' }}>Not set</span>}
                    </div>

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

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{editId ? 'Edit SerpAPI Key' : 'Add SerpAPI Key'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertTriangle size={14} /> {error}</div>}

              <div className="form-group">
                <label>Display Name *</label>
                <input className="form-control" value={form.display_name} placeholder="e.g. SerpAPI – main account"
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </div>

              <div className="form-group">
                <label>SerpAPI Key *</label>
                <input className="form-control" value={form.api_key} placeholder="Your SerpAPI key"
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
                <small style={{ color: 'var(--text-secondary)' }}>From serpapi.com → Dashboard → API Key</small>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" rows={2} value={form.description} placeholder="Optional notes, e.g. free trial account"
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
                  Set as Default (tried first)
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
