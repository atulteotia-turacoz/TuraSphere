import React, { useState, useEffect } from 'react';
import {
  Brain, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  Zap, Star, TestTube, Eye, EyeOff, RefreshCw,
} from 'lucide-react';
import {
  listAIConfigs, createAIConfig, updateAIConfig, deleteAIConfig,
  testAIConfig, setDefaultAI,
} from '../services/api';

const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'] },
  { value: 'claude', label: 'Anthropic Claude', models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'] },
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'] },
  { value: 'gemini', label: 'Google Gemini', models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'] },
  { value: 'llama', label: 'Meta LLaMA', models: ['llama-3.1-70b', 'llama-3.1-8b', 'llama-3.2-90b'] },
  { value: 'mistral', label: 'Mistral AI', models: ['mistral-large', 'mistral-medium', 'mistral-small', 'mixtral-8x7b'] },
  { value: 'groq', label: 'Groq', models: ['llama3-70b-8192', 'mixtral-8x7b-32768'] },
  { value: 'custom', label: 'Custom / Self-hosted', models: [] },
];

const emptyForm = {
  provider: 'openai', display_name: '', api_key: '', api_base_url: '',
  model_name: '', max_tokens: 4096, temperature: 0.7,
  is_active: true, is_default: false, description: '',
};

export default function AIConfigPage() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showKeys, setShowKeys] = useState({});
  const [testResult, setTestResult] = useState(null);

  const fetchConfigs = async () => {
    try {
      const res = await listAIConfigs();
      setConfigs(res.data);
    } catch (err) {
      setError('Failed to load AI configurations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfigs(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setError('');
    setShowModal(true);
  };

  const openEdit = (config) => {
    setEditId(config.id);
    setForm({
      provider: config.provider, display_name: config.display_name,
      api_key: config.api_key || '', api_base_url: config.api_base_url || '',
      model_name: config.model_name || '', max_tokens: config.max_tokens,
      temperature: config.temperature, is_active: config.is_active,
      is_default: config.is_default, description: config.description || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.display_name.trim()) { setError('Display name is required'); return; }
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await updateAIConfig(editId, form);
        setSuccess('AI configuration updated successfully');
      } else {
        await createAIConfig(form);
        setSuccess('AI configuration created successfully');
      }
      setShowModal(false);
      fetchConfigs();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAIConfig(id);
      setDeleteConfirm(null);
      setSuccess('AI configuration deleted');
      fetchConfigs();
    } catch (err) {
      setError('Failed to delete');
    }
  };

  const handleTest = async (id) => {
    setTestResult(null);
    try {
      const res = await testAIConfig(id);
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ success: false, message: 'Test failed' });
    }
    setTimeout(() => setTestResult(null), 4000);
  };

  const handleSetDefault = async (id) => {
    try {
      await setDefaultAI(id);
      setSuccess('Default AI provider updated');
      fetchConfigs();
    } catch (err) {
      setError('Failed to set default');
    }
  };

  const toggleKeyVisibility = (id) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const maskKey = (key) => key ? key.slice(0, 8) + '••••••••' + key.slice(-4) : '—';

  const selectedProvider = AI_PROVIDERS.find((p) => p.value === form.provider);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title"><Brain size={24} /> AI Configuration</h1>
          <p className="page-subtitle">Manage AI provider integrations for KOL assessment analysis</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Add Provider</button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {testResult && (
        <div className={`alert ${testResult.success ? 'alert-success' : 'alert-danger'}`}>
          <TestTube size={16} /> {testResult.message}
        </div>
      )}

      {/* Config Cards */}
      {configs.length === 0 ? (
        <div className="empty-state">
          <Brain size={48} />
          <h3>No AI Providers Configured</h3>
          <p>Add your first AI provider to enable intelligent KOL assessment features.</p>
          <button className="btn btn-primary mt-4" onClick={openCreate}><Plus size={16} /> Add Provider</button>
        </div>
      ) : (
        <div className="config-grid">
          {configs.map((cfg) => (
            <div key={cfg.id} className={`config-card ${cfg.is_active ? '' : 'inactive'} ${cfg.is_default ? 'default' : ''}`}>
              <div className="config-card-header">
                <div className="config-provider-info">
                  <div className={`config-provider-icon ${cfg.provider}`}>
                    <Brain size={18} />
                  </div>
                  <div>
                    <h3>{cfg.display_name}</h3>
                    <span className="config-provider-label">{cfg.provider.toUpperCase()}</span>
                  </div>
                </div>
                <div className="config-badges">
                  {cfg.is_default && <span className="badge badge-primary"><Star size={10} /> Default</span>}
                  <span className={`badge ${cfg.is_active ? 'badge-success' : 'badge-danger'}`}>
                    {cfg.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="config-card-body">
                <div className="config-detail-row">
                  <span className="config-label">Model</span>
                  <span className="config-value">{cfg.model_name || '—'}</span>
                </div>
                <div className="config-detail-row">
                  <span className="config-label">API Key</span>
                  <span className="config-value mono">
                    {showKeys[cfg.id] ? cfg.api_key : maskKey(cfg.api_key)}
                    <button className="btn-icon-xs" onClick={() => toggleKeyVisibility(cfg.id)}>
                      {showKeys[cfg.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </span>
                </div>
                <div className="config-detail-row">
                  <span className="config-label">Max Tokens</span>
                  <span className="config-value">{cfg.max_tokens}</span>
                </div>
                <div className="config-detail-row">
                  <span className="config-label">Temperature</span>
                  <span className="config-value">{cfg.temperature}</span>
                </div>
                {cfg.api_base_url && (
                  <div className="config-detail-row">
                    <span className="config-label">Base URL</span>
                    <span className="config-value mono">{cfg.api_base_url}</span>
                  </div>
                )}
                {cfg.description && (
                  <div className="config-detail-row">
                    <span className="config-label">Notes</span>
                    <span className="config-value">{cfg.description}</span>
                  </div>
                )}
              </div>

              <div className="config-card-actions">
                <button className="btn btn-sm btn-outline" onClick={() => handleTest(cfg.id)}><TestTube size={14} /> Test</button>
                {!cfg.is_default && (
                  <button className="btn btn-sm btn-outline" onClick={() => handleSetDefault(cfg.id)}><Star size={14} /> Set Default</button>
                )}
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(cfg)}><Edit2 size={14} /> Edit</button>
                <button className="btn btn-sm btn-outline danger" onClick={() => setDeleteConfirm(cfg.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit AI Configuration' : 'Add AI Provider'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger mb-4"><AlertTriangle size={14} /> {error}</div>}

              <div className="form-row">
                <div className="form-group">
                  <label>Provider *</label>
                  <select className="form-control" value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value, model_name: '' })}>
                    {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Display Name *</label>
                  <input className="form-control" value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    placeholder="e.g. GPT-4 Production" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>API Key</label>
                  <input className="form-control" type="password" value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder="sk-..." />
                </div>
                <div className="form-group">
                  <label>Model</label>
                  {selectedProvider && selectedProvider.models.length > 0 ? (
                    <select className="form-control" value={form.model_name}
                      onChange={(e) => setForm({ ...form, model_name: e.target.value })}>
                      <option value="">Select model</option>
                      {selectedProvider.models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input className="form-control" value={form.model_name}
                      onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                      placeholder="Enter model name" />
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>API Base URL (optional, for custom endpoints)</label>
                <input className="form-control" value={form.api_base_url}
                  onChange={(e) => setForm({ ...form, api_base_url: e.target.value })}
                  placeholder="https://api.openai.com/v1" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Max Tokens</label>
                  <input className="form-control" type="number" value={form.max_tokens}
                    onChange={(e) => setForm({ ...form, max_tokens: parseInt(e.target.value) || 4096 })} />
                </div>
                <div className="form-group">
                  <label>Temperature (0-2)</label>
                  <input className="form-control" type="number" step="0.1" min="0" max="2" value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0.7 })} />
                </div>
              </div>

              <div className="form-group">
                <label>Description / Notes</label>
                <textarea className="form-control" rows={2} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Internal notes about this configuration" />
              </div>

              <div className="form-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  <span>Active</span>
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                  <span>Set as Default Provider</span>
                </label>
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
              <h3>Delete Configuration?</h3>
              <p>This action cannot be undone. The AI provider configuration will be permanently removed.</p>
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
