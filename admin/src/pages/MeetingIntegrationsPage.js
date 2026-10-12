import React, { useState, useEffect } from 'react';
import { Video, Check, X, Edit2, Trash2, Plus, CheckCircle } from 'lucide-react';
import {
  listMeetingProviderConfigs, upsertMeetingProviderConfig, deleteMeetingProviderConfig,
} from '../services/api';

const PROVIDERS = [
  { id: 'zoom', label: 'Zoom', color: '#2D8CFF', note: 'Server-to-Server OAuth app' },
  { id: 'teams', label: 'Microsoft Teams', color: '#5059C9', note: 'Azure app (Graph API)' },
];

export default function MeetingIntegrationsPage() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // 'zoom' | 'teams' | null
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setConfigs((await listMeetingProviderConfigs()).data || []); }
    catch (e) { setError(e.response?.data?.detail || 'Failed to load meeting integrations'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const byProvider = (p) => configs.find(c => c.provider === p);

  const remove = async (cfg) => {
    if (!window.confirm(`Delete the ${cfg.provider} configuration?`)) return;
    try { await deleteMeetingProviderConfig(cfg.id); setSuccess('Configuration deleted'); load(); }
    catch (e) { setError(e.response?.data?.detail || 'Delete failed'); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><Video size={24} /> Teams & Zoom Integrations</h1>
          <p className="page-subtitle">Configure the meeting platforms used to create advisory board meetings.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger"><X size={16} /> {error}</div>}
      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}

      <div className="config-grid">
        {PROVIDERS.map(p => {
          const cfg = byProvider(p.id);
          if (editing === p.id) {
            return (
              <ProviderForm
                key={p.id}
                provider={p}
                initial={cfg}
                onCancel={() => setEditing(null)}
                onSaved={() => { setEditing(null); setSuccess(`${p.label} saved`); load(); }}
                onError={setError}
              />
            );
          }
          return (
            <div key={p.id} className="config-card" style={{ borderTop: `3px solid ${p.color}` }}>
              <div className="config-card-header">
                <div className="config-provider-info">
                  <div className="config-provider-icon" style={{ background: `${p.color}1A`, color: p.color }}>
                    <Video size={18} />
                  </div>
                  <div>
                    <h3>{p.label}</h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.note}</span>
                  </div>
                </div>
                {cfg?.is_active && (
                  <span className="badge badge-success"><CheckCircle size={12} /> Active</span>
                )}
              </div>

              <div className="config-card-body">
                {cfg ? (
                  <>
                    <Row label="Client ID" value={cfg.client_id || '—'} />
                    <Row label="Client Secret" value={cfg.has_client_secret ? cfg.client_secret : '— (not set)'} />
                    {p.id === 'zoom' && <Row label="Account ID" value={cfg.account_id || '—'} />}
                    {p.id === 'teams' && <Row label="Tenant ID" value={cfg.tenant_id || '—'} />}
                    {p.id === 'teams' && <Row label="Organizer User ID" value={cfg.extra_config?.organizer_user_id || '—'} />}
                  </>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '8px 0' }}>Not configured.</p>
                )}
              </div>

              <div className="config-card-footer" style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => setEditing(p.id)}>
                  {cfg ? <><Edit2 size={14} /> Edit</> : <><Plus size={14} /> Configure</>}
                </button>
                {cfg && (
                  <button className="btn btn-sm btn-danger" onClick={() => remove(cfg)}><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="config-detail-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

function ProviderForm({ provider, initial, onCancel, onSaved, onError }) {
  const p = provider.id;
  const existingExtra = initial?.extra_config || {};
  const [clientId, setClientId] = useState(initial?.client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState(initial?.tenant_id || '');
  const [accountId, setAccountId] = useState(initial?.account_id || '');
  const [organizerUserId, setOrganizerUserId] = useState(existingExtra.organizer_user_id || '');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isActive, setIsActive] = useState(initial?.is_active ?? (p === 'zoom'));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const extra = { ...existingExtra };
      if (webhookSecret) extra.webhook_secret = webhookSecret;
      if (p === 'teams') extra.organizer_user_id = organizerUserId.trim() || undefined;
      await upsertMeetingProviderConfig({
        provider: p,
        is_active: isActive,
        client_id: clientId.trim() || null,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        tenant_id: p === 'teams' ? (tenantId.trim() || null) : null,
        account_id: p === 'zoom' ? (accountId.trim() || null) : null,
        extra_config: Object.keys(extra).length ? extra : null,
      });
      onSaved();
    } catch (e) {
      onError(e.response?.data?.detail || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="config-card" style={{ borderTop: `3px solid ${provider.color}` }}>
      <div className="config-card-header">
        <h3 style={{ margin: 0 }}>Configure {provider.label}</h3>
        <button className="btn-icon" onClick={onCancel}><X size={16} /></button>
      </div>
      <div className="config-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Client ID">
          <input className="form-input" value={clientId} onChange={e => setClientId(e.target.value)} autoFocus />
        </Field>
        <Field label={`Client Secret ${initial?.has_client_secret ? '(leave blank to keep existing)' : ''}`}>
          <input className="form-input" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
            placeholder={initial?.has_client_secret ? '••••••••' : ''} />
        </Field>
        {p === 'zoom' && (
          <>
            <Field label="Account ID (Server-to-Server OAuth)">
              <input className="form-input" value={accountId} onChange={e => setAccountId(e.target.value)} />
            </Field>
            <Field label="Webhook Secret Token (optional)">
              <input className="form-input" type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder="From Zoom Marketplace → Event Subscriptions" />
            </Field>
          </>
        )}
        {p === 'teams' && (
          <>
            <Field label="Tenant ID">
              <input className="form-input" value={tenantId} onChange={e => setTenantId(e.target.value)} />
            </Field>
            <Field label="Organizer User ID (AAD object id)">
              <input className="form-input" value={organizerUserId} onChange={e => setOrganizerUserId(e.target.value)}
                placeholder="Azure AD user the Teams meetings are created for" />
            </Field>
          </>
        )}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.88rem', marginTop: 4 }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
          Make this the active (default) meeting provider
        </label>
      </div>
      <div className="config-card-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px' }}>
        <button className="btn btn-sm btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
