import React, { useState, useEffect } from 'react';
import {
  BookOpen, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  RefreshCw, Star, StarOff, Wifi, WifiOff,
} from 'lucide-react';
import {
  listGSConfigs, createGSConfig, updateGSConfig,
  deleteGSConfig, testGSConfig, setDefaultGS,
} from '../services/api';

const emptyForm = {
  display_name: '',
  api_key: '',
  provider: 'direct',
  base_url: 'https://scholar.google.com/scholar',
  proxy_url: '',
  requests_per_minute: 10,
  is_active: true,
  is_default: false,
  description: '',
};

export default function GoogleScholarConfigPage() {
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
      const res = await listGSConfigs();
      setConfigs(res.data);
    } catch {
      setError('Failed to load Google Scholar configurations');
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
      api_key: cfg.api_key || '',
      provider: cfg.provider || 'direct',
      base_url: cfg.base_url || emptyForm.base_url,
      proxy_url: cfg.proxy_url || '',
      requests_per_minute: cfg.requests_per_minute || 10,
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
        await updateGSConfig(editId, form);
        setSuccess('Configuration updated');
      } else {
        await createGSConfig(form);
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
      await deleteGSConfig(id);
      setSuccess('Configuration deleted');
      setDeleteConfirm(null);
      fetchConfigs();
    } catch { setError('Failed to delete'); }
  };

  const handleTest = async (id) => {
    setTesting(id); setTestResult(null);
    try {
      const res = await testGSConfig(id);
      setTestResult({ id, ...res.data });
    } catch {
      setTestResult({ id, success: false, message: 'Connection test failed' });
    } finally { setTesting(null); }
  };

  const handleSetDefault = async (id) => {
    try {
      await setDefaultGS(id);
      setSuccess('Default configuration updated');
      fetchConfigs();
    } catch { setError('Failed to set default'); }
  };

  if (loading) return <div className="admin-page"><div className="loading-spinner"><div className="spinner" /></div></div>;

  return (
    <div className="admin-page">
      <div className="page-header-row">
        <div>
          <h1><BookOpen size={24} /> Google Scholar Configuration</h1>
          <p className="page-subtitle">Configure Google Scholar access for guideline authorship detection</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> Add Configuration
        </button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && !showModal && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

      {/* Info Card */}
      <div className="card" style={{ marginBottom: 20, background: 'var(--tier-platinum-bg)', border: '1px solid var(--tier-platinum-bg)' }}>
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--tier-platinum)' }}>
            <strong>Google Scholar:</strong> Used for <strong>C.8 Guideline Authority</strong> scoring.
            You can use <strong>Direct mode</strong> (free, scrapes Google Scholar directly — may face rate limits)
            or <strong>SerpAPI mode</strong> (requires API key from{' '}
            <a href="https://serpapi.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tier-platinum)' }}>
              serpapi.com
            </a> — more reliable, 100 free searches/month).
          </p>
        </div>
      </div>

      {configs.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
            <BookOpen size={48} style={{ color: 'var(--border-strong)', marginBottom: 12 }} />
            <h3>No Google Scholar Configuration</h3>
            <p>Add a configuration to enable guideline authorship detection.</p>
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
                      <span style={{
                        fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10,
                        background: cfg.provider === 'serpapi' ? 'var(--info-light)' : 'var(--content-raised)',
                        color: cfg.provider === 'serpapi' ? 'var(--info)' : 'var(--text-secondary)',
                        fontWeight: 500,
                      }}>
                        {cfg.provider === 'serpapi' ? 'SerpAPI' : 'Direct'}
                      </span>
                    </div>
                    {cfg.description && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '4px 0 12px' }}>{cfg.description}</p>
                    )}
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {cfg.provider === 'serpapi' && (
                        <div>
                          <strong>API Key:</strong>{' '}
                          {cfg.api_key ? `${cfg.api_key.slice(0, 8)}...` : <span style={{ color: 'var(--danger)' }}>Not set</span>}
                        </div>
                      )}
                      <div><strong>Rate Limit:</strong> {cfg.requests_per_minute} req/min</div>
                      {cfg.proxy_url && <div><strong>Proxy:</strong> {cfg.proxy_url}</div>}
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Google Scholar Configuration' : 'Add Google Scholar Configuration'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertTriangle size={14} /> {error}</div>}

              <div className="form-group">
                <label>Display Name *</label>
                <input className="form-control" value={form.display_name} placeholder="e.g. Google Scholar Production"
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Provider</label>
                <select className="form-control" value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                  <option value="direct">Direct (Free — scrapes Google Scholar)</option>
                  <option value="serpapi">SerpAPI (Requires API key — more reliable)</option>
                </select>
              </div>

              {form.provider === 'serpapi' && (
                <div className="form-group">
                  <label>SerpAPI Key</label>
                  <input className="form-control" value={form.api_key} placeholder="Your SerpAPI key"
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
                  <small style={{ color: 'var(--text-secondary)' }}>Get from serpapi.com — 100 free searches/month</small>
                </div>
              )}

              <div className="form-group">
                <label>{form.provider === 'serpapi' ? 'SerpAPI Base URL' : 'Google Scholar URL'}</label>
                <input className="form-control" value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
              </div>

              {form.provider === 'direct' && (
                <div className="form-group">
                  <label>Proxy URL (optional)</label>
                  <input className="form-control" value={form.proxy_url} placeholder="http://proxy:port"
                    onChange={(e) => setForm({ ...form, proxy_url: e.target.value })} />
                  <small style={{ color: 'var(--text-secondary)' }}>Optional proxy to avoid rate limiting by Google</small>
                </div>
              )}

              <div className="form-group" style={{ maxWidth: 200 }}>
                <label>Requests/Minute</label>
                <input className="form-control" type="number" min="1" max="100" value={form.requests_per_minute}
                  onChange={(e) => setForm({ ...form, requests_per_minute: parseInt(e.target.value) || 10 })} />
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
