import React, { useState, useEffect } from 'react';
import {
  Twitter, Check, AlertTriangle, RefreshCw, Wifi, WifiOff, Trash2, Save, Eye, EyeOff,
} from 'lucide-react';
import {
  getTwitterConfig, saveTwitterConfig, deleteTwitterConfig, testTwitterConfig,
} from '../services/api';

const emptyForm = {
  display_name: '',
  username: '',
  api_key: '',
  api_secret: '',
  client_id: '',
  client_secret: '',
  bearer_token: '',
  access_token: '',
  access_token_secret: '',
  is_active: true,
  description: '',
};

// Secrets are never sent back to the browser — only a masked preview. Leaving one
// blank on save keeps whatever is already stored.
const SECRETS = ['api_secret', 'client_secret', 'bearer_token', 'access_token', 'access_token_secret'];

export default function TwitterConfigPage() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const fetchConfig = async (reveal = false) => {
    try {
      const res = await getTwitterConfig(reveal);
      const d = res.data;
      setCfg(d);
      setForm({
        ...emptyForm,
        display_name: d.display_name || '',
        username: d.username || '',
        api_key: d.api_key || '',
        client_id: d.client_id || '',
        is_active: d.is_active !== false,
        description: d.description || '',
        // When revealed, the server sends the real secrets — drop them straight into
        // the fields so they're visible and copyable. Otherwise leave the boxes empty
        // (blank = keep the stored value on save).
        ...(d.revealed ? {
          api_secret: d.api_secret || '',
          client_secret: d.client_secret || '',
          bearer_token: d.bearer_token || '',
          access_token: d.access_token || '',
          access_token_secret: d.access_token_secret || '',
        } : {}),
      });
    } catch {
      setError('Failed to load X (Twitter) configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfig(); }, []);

  const toggleReveal = async () => {
    const next = !revealed;
    setRevealed(next);
    await fetchConfig(next);
  };

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const payload = { ...form };
      // Drop blank secrets so the stored values survive a save.
      SECRETS.forEach(k => { if (!payload[k]) delete payload[k]; });
      await saveTwitterConfig(payload);
      setSuccess('X (Twitter) configuration saved');
      setTestResult(null);
      await fetchConfig(revealed);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await testTwitterConfig();
      setTestResult(res.data);
    } catch {
      setTestResult({ success: false, message: 'Connection test failed' });
    } finally { setTesting(false); }
  };

  const handleDelete = async () => {
    try {
      await deleteTwitterConfig();
      setSuccess('X (Twitter) configuration removed');
      setConfirmDelete(false);
      setTestResult(null);
      await fetchConfig(revealed);
    } catch { setError('Failed to remove configuration'); }
  };

  if (loading) return <div className="admin-page"><div className="loading-spinner"><div className="spinner" /></div></div>;

  const configured = cfg?.configured;
  // When revealed, the box already holds the real value — a "leave blank to keep"
  // hint would be nonsense there.
  const secretType = revealed ? 'text' : 'password';
  const secretHint = (value, has) => {
    if (revealed) return has ? 'Shown in full — handle with care' : 'Not set';
    return has ? `Saved (${value}) — leave blank to keep` : 'Not set';
  };

  return (
    <div className="admin-page">
      <div className="page-header-row">
        <div>
          <h1><Twitter size={24} /> X (Twitter) Integration</h1>
          <p className="page-subtitle">
            Platform-wide X (Twitter) API credentials. Individual accounts can override these
            with their own from <strong>Account → X (Twitter)</strong>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={handleTest} disabled={testing}>
            {testing ? <RefreshCw size={14} className="spinning" /> : <Wifi size={14} />} Test
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

      <div className="card" style={{ marginBottom: 20, background: 'var(--info-light)', border: '1px solid var(--info-light)' }}>
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--info)' }}>
            <strong>X API:</strong> Create a Project &amp; App in the{' '}
            <strong>X Developer Portal</strong> to obtain these credentials. The{' '}
            <strong>API Key + Secret</strong> and a <strong>Bearer Token</strong> are enough for
            read-only (app-only) requests. Posting additionally requires an{' '}
            <strong>Access Token + Secret</strong> pair. Paste the Bearer Token{' '}
            <strong>exactly</strong> as shown — including any <code>%2B</code> / <code>%3D</code>;
            decoding those makes X reject it. All secrets are encrypted at rest and are never
            returned to the browser.
          </p>
        </div>
      </div>

      {testResult && (
        <div className="alert" style={{
          background: testResult.success ? 'var(--success-light)' : 'var(--danger-light)',
          color: testResult.success ? 'var(--success)' : 'var(--danger)',
          border: `1px solid ${testResult.success ? 'var(--success-light)' : 'var(--danger-light)'}`,
        }}>
          {testResult.success ? <Wifi size={16} /> : <WifiOff size={16} />} {testResult.message}
        </div>
      )}

      <div className="card">
        <div className="card-body" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <h3 style={{ margin: 0 }}>Platform Credentials</h3>
            {configured
              ? <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>Configured</span>
              : <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>Not Configured</span>}
            {cfg?.username && <span style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>@{cfg.username}</span>}

            {cfg?.id && (
              <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }}
                onClick={toggleReveal}
                title={revealed ? 'Hide the stored secrets' : 'Fetch and display the stored secrets in full'}>
                {revealed ? <><EyeOff size={14} /> Hide secrets</> : <><Eye size={14} /> Show secrets</>}
              </button>
            )}
          </div>

          {revealed && (
            <div className="alert" style={{
              marginBottom: 16, background: 'var(--warning-light)', color: 'var(--warning)', border: '1px solid var(--warning-light)',
            }}>
              <AlertTriangle size={16} />
              <span>
                Secrets are shown in full. Anyone looking at this screen can read them — hide them
                again when you're done.
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label>Display Name</label>
              <input className="form-control" value={form.display_name} placeholder="e.g. TuraSphere X App"
                onChange={e => set('display_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Handle (@username)</label>
              <input className="form-control" value={form.username} placeholder="turaquant"
                onChange={e => set('username', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label>API Key (Consumer Key)</label>
              <input className="form-control" value={form.api_key} placeholder="X App API / Consumer Key"
                onChange={e => set('api_key', e.target.value)} />
            </div>
            <div className="form-group">
              <label>API Secret (Secret Key)</label>
              <input className="form-control" type={secretType} value={form.api_secret}
                spellCheck={false}
                onChange={e => set('api_secret', e.target.value)} />
              <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{secretHint(cfg?.api_secret, cfg?.has_api_secret)}</small>
            </div>
          </div>

          <div className="form-group">
            <label>Bearer Token</label>
            <input className="form-control" type={secretType} value={form.bearer_token}
              spellCheck={false}
              onChange={e => set('bearer_token', e.target.value)} />
            <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              App-only token — enough for read access. {secretHint(cfg?.bearer_token, cfg?.has_bearer_token)}
            </small>
          </div>

          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
            The two fields below are <strong>optional</strong> — needed only to post. Read-only
            integrations can leave them blank.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label>Access Token (optional)</label>
              <input className="form-control" type={secretType} value={form.access_token}
                spellCheck={false}
                onChange={e => set('access_token', e.target.value)} />
              <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{secretHint(cfg?.access_token, cfg?.has_access_token)}</small>
            </div>
            <div className="form-group">
              <label>Access Token Secret (optional)</label>
              <input className="form-control" type={secretType} value={form.access_token_secret}
                spellCheck={false}
                onChange={e => set('access_token_secret', e.target.value)} />
              <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{secretHint(cfg?.access_token_secret, !!cfg?.access_token)}</small>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label>OAuth 2.0 Client ID (optional)</label>
              <input className="form-control" value={form.client_id} placeholder="OAuth 2.0 Client ID"
                onChange={e => set('client_id', e.target.value)} />
            </div>
            <div className="form-group">
              <label>OAuth 2.0 Client Secret (optional)</label>
              <input className="form-control" type={secretType} value={form.client_secret}
                spellCheck={false}
                onChange={e => set('client_secret', e.target.value)} />
              <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{secretHint(cfg?.client_secret, !!cfg?.client_secret)}</small>
            </div>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea className="form-control" rows={2} value={form.description} placeholder="Optional notes..."
              onChange={e => set('description', e.target.value)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)} />
              Active
            </label>

            {cfg?.id && (
              confirmDelete ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-danger" onClick={handleDelete}>Confirm Remove</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-sm btn-ghost" style={{ color: 'var(--color-error, var(--danger))' }}
                  onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} /> Remove Configuration
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
