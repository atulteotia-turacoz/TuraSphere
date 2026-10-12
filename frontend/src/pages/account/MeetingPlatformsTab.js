import React, { useCallback, useEffect, useState } from 'react';
import { Video, Save, Trash2, CheckCircle, AlertTriangle, Star, Circle, Wifi } from 'lucide-react';
import {
  listAccountMeetingProviders, upsertAccountMeetingProvider,
  deleteAccountMeetingProvider, getAccountConfigStatus, testAccountLiveKit,
} from '../../services/api';

// Group a provider's fields by their `group` key, preserving order, so each
// credential set can render under its own sub-heading.
function groupFields(fields) {
  const out = [];
  fields.forEach((f) => {
    const key = f.group || '';
    const last = out[out.length - 1];
    if (last && last.key === key) last.fields.push(f);
    else out.push({ key, fields: [f] });
  });
  return out;
}

// Sub-headings for Zoom's two credential sets (two separate Marketplace apps).
const GROUP_LABELS = {
  oauth: { title: 'Server-to-Server OAuth app', sub: 'Creates the Zoom meeting link (required).' },
  sdk:   { title: 'Meeting SDK app', sub: 'Lets people join the call inside this app instead of zoom.us (optional). This is a separate app from the one above.' },
};

const PROVIDERS = [
  {
    id: 'zoom', label: 'Zoom', color: '#2D8CFF',
    fields: [
      { key: 'account_id', label: 'Account ID', group: 'oauth' },
      { key: 'client_id', label: 'Client ID', group: 'oauth' },
      { key: 'client_secret', label: 'Client Secret', secret: true, group: 'oauth' },
      { key: 'sdk_key', label: 'Client ID', extra: true, group: 'sdk' },
      { key: 'sdk_secret', label: 'Client Secret', secret: true, extra: true, group: 'sdk' },
    ],
    hint: 'These come from TWO different Zoom Marketplace apps — paste each app\'s own Client ID / '
        + 'Client Secret into its section below.',
  },
  {
    id: 'teams', label: 'Microsoft Teams', color: '#5059C9',
    fields: [
      { key: 'tenant_id', label: 'Tenant ID' },
      { key: 'client_id', label: 'Client ID (App ID)' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'organizer_user_id', label: 'Organizer User ID (AAD object id)', extra: true },
    ],
    hint: 'Azure AD app with OnlineMeetings.ReadWrite.All + an application access policy.',
  },
  {
    // The one platform WE host, so unlike Zoom/Teams there is nothing to sign up
    // for and every field is optional — leaving them blank uses our server.
    id: 'livekit', label: 'LiveKit (built-in)', color: '#FF6352',
    selfHosted: true,
    fields: [
      { key: 'tenant_id', label: 'LiveKit URL', placeholder: 'wss://livekit.yourcompany.com' },
      { key: 'client_id', label: 'API Key' },
      { key: 'client_secret', label: 'API Secret', secret: true },
    ],
    hint: 'Video, screen share and recording built into this platform — no external account, '
        + 'no paid plan, and recordings are stored here rather than in a third party. '
        + 'Leave the fields blank to use our server; fill them in only to point at your own '
        + 'LiveKit deployment.',
  },
];

export default function MeetingPlatformsTab({ onNotice }) {
  const [configs, setConfigs] = useState([]);
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, statusRes] = await Promise.all([listAccountMeetingProviders(), getAccountConfigStatus()]);
      setConfigs(cfgRes.data || []);
      setStatus(statusRes.data || {});
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to load meeting platforms');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="account-card"><div className="account-card-body">Loading…</div></div>;

  // Only one platform can be active per account (the API enforces it), so this is
  // a single choice — surfaced up here rather than leaving the user to infer it
  // from three separate checkboxes.
  const active = configs.find((c) => c.is_active);
  const activeDef = PROVIDERS.find((p) => p.id === active?.provider);

  return (
    <div className="account-card">
      <div className="account-card-header">
        <h3><Video size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Meeting Platforms</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          Choose how your board meetings run. <strong>LiveKit is built in</strong> and needs no
          account — pick Zoom or Teams instead if you already pay for one and would rather use it.
        </p>
      </div>
      <div className="account-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 8,
          background: activeDef ? `${activeDef.color}14` : 'var(--color-bg-secondary, var(--color-bg))',
          border: `1px solid ${activeDef ? `${activeDef.color}55` : 'var(--color-border-light)'}`,
        }}>
          <Star size={15} style={{ color: activeDef?.color || 'var(--color-text-light)' }} />
          <span style={{ fontSize: '0.86rem' }}>
            {activeDef ? (
              <>Meetings currently use <strong style={{ color: activeDef.color }}>{activeDef.label}</strong>.</>
            ) : (
              <>No default chosen yet — meetings fall back to <strong>LiveKit</strong> if it's available,
                otherwise to whichever platform is configured.</>
            )}
          </span>
        </div>

        {PROVIDERS.map((p) => (
          <ProviderForm
            key={p.id}
            def={p}
            existing={configs.find((c) => c.provider === p.id)}
            source={status?.[p.id]?.source}
            isActive={active?.provider === p.id}
            onSaved={(msg) => { onNotice?.('success', msg); refresh(); }}
            onError={(msg) => onNotice?.('error', msg)}
            onRefresh={refresh}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderForm({ def, existing, source, isActive, onSaved, onError, onRefresh }) {
  const extra = existing?.extra_config || {};
  const initial = {
    is_active: existing?.is_active ?? false,
    client_id: existing?.client_id || '',
    client_secret: '',
    tenant_id: existing?.tenant_id || '',
    account_id: existing?.account_id || '',
    organizer_user_id: extra.organizer_user_id || '',
    sdk_key: extra.sdk_key || '',
    sdk_secret: '',
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Per-field "secret already stored" flag (client_secret lives on the row,
  // sdk_secret lives in extra_config).
  const hasSecretFor = (f) =>
    f.key === 'sdk_secret' ? !!existing?.extra_config?.has_sdk_secret : !!existing?.has_client_secret;

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        provider: def.id,
        is_active: form.is_active,
        client_id: form.client_id || null,
        tenant_id: form.tenant_id || null,
        account_id: form.account_id || null,
      };
      if (def.id === 'livekit') {
        // Nothing extra: URL/key/secret ride on the generic columns, and blank
        // means "use the platform's server".
      } else if (def.id === 'teams') {
        payload.extra_config = { organizer_user_id: form.organizer_user_id || null };
      } else if (def.id === 'zoom') {
        // Meeting SDK creds live in extra_config. Backend keeps the stored secret
        // when sdk_secret is blank, so only send it when the user typed a new one.
        payload.extra_config = { sdk_key: form.sdk_key || null };
        if (form.sdk_secret) payload.extra_config.sdk_secret = form.sdk_secret;
      }
      if (form.client_secret) payload.client_secret = form.client_secret;  // keep stored when blank
      await upsertAccountMeetingProvider(payload);
      onSaved(`${def.label} configuration saved.`);
    } catch (e) {
      onError(e.response?.data?.detail || `Failed to save ${def.label}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove your ${def.label} configuration?`)) return;
    try { await deleteAccountMeetingProvider(def.id); onSaved(`${def.label} configuration removed.`); onRefresh(); }
    catch (e) { onError(e.response?.data?.detail || 'Failed to remove'); }
  };

  // Proving the connection here beats discovering it mid-meeting.
  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await testAccountLiveKit();
      setTestResult({ ok: r.data.ok, message: r.data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.detail || 'Could not reach LiveKit.' });
    } finally { setTesting(false); }
  };

  // Making a platform the default is a single choice across all three, so this
  // reads as a radio. Unchecking is meaningless — you pick a different one
  // instead — so the active card's control is disabled rather than clickable.
  const makeDefault = async () => {
    if (isActive) return;
    setForm((f) => ({ ...f, is_active: true }));
    setSaving(true);
    try {
      const payload = { provider: def.id, is_active: true,
        client_id: form.client_id || null,
        tenant_id: form.tenant_id || null,
        account_id: form.account_id || null };
      if (form.client_secret) payload.client_secret = form.client_secret;
      await upsertAccountMeetingProvider(payload);
      onSaved(`${def.label} is now your default meeting platform.`);
    } catch (e) {
      setForm((f) => ({ ...f, is_active: false }));
      onError(e.response?.data?.detail || 'Could not change the default platform.');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ border: `1px solid var(--color-border-light)`, borderTop: `3px solid ${def.color}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, color: def.color }}>{def.label}</h4>
        <SourceTag source={source} />
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--color-text-light)' }}>{def.hint}</p>

      {groupFields(def.fields).map((grp) => {
        const meta = GROUP_LABELS[grp.key];
        return (
          <div key={grp.key || 'default'} style={{ marginBottom: 12 }}>
            {meta && (
              <div style={{ margin: '6px 0 8px', paddingTop: grp.key === 'sdk' ? 10 : 0, borderTop: grp.key === 'sdk' ? '1px dashed var(--color-border-light)' : 'none' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text)' }}>{meta.title}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{meta.sub}</div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {grp.fields.map((f) => {
                const kept = f.secret && hasSecretFor(f);
                return (
                  <div key={f.key}>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
                      {f.label}{kept ? ' (leave blank to keep)' : ''}
                    </label>
                    <input
                      className="form-control"
                      type={f.secret ? 'password' : 'text'}
                      value={form[f.key] || ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={kept ? '••••••••' : (f.placeholder || '')}
                      autoComplete="off"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {testResult && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '8px 11px',
          borderRadius: 7, fontSize: '0.8rem',
          background: testResult.ok ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
          color: testResult.ok ? 'var(--color-success-text)' : 'var(--color-error-text)',
          border: `1px solid ${testResult.ok ? 'var(--color-success-bg)' : 'var(--color-error-bg)'}`,
        }}>
          {testResult.ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          {testResult.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={makeDefault}
          disabled={isActive || saving}
          title={isActive ? `${def.label} is already your default` : `Use ${def.label} for your meetings`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px',
            borderRadius: 999, fontSize: '0.82rem', fontWeight: 600,
            cursor: isActive ? 'default' : 'pointer',
            border: `1px solid ${isActive ? def.color : 'var(--color-border)'}`,
            background: isActive ? def.color : 'var(--color-text-inverse)',
            color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
          }}>
          {isActive ? <CheckCircle size={14} /> : <Circle size={14} />}
          {isActive ? 'Default platform' : 'Use this platform'}
        </button>

        {def.selfHosted && (
          <button className="btn btn-sm btn-ghost" onClick={test} disabled={testing}>
            <Wifi size={14} /> {testing ? 'Testing…' : 'Test connection'}
          </button>
        )}

        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
        {existing && (
          <button className="btn btn-sm btn-ghost" onClick={remove} title={`Remove your ${def.label} configuration`}
            style={{ color: 'var(--color-danger, var(--color-error))' }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {isActive && !existing && def.selfHosted && (
        <p style={{ margin: '10px 0 0', fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
          Running on our LiveKit server. Nothing else to set up.
        </p>
      )}
    </div>
  );
}

function SourceTag({ source }) {
  if (source === 'account') {
    return <span style={tag('var(--color-success)')}><CheckCircle size={12} /> Using your config</span>;
  }
  if (source === 'platform') {
    return <span style={tag('var(--color-warning)')}><AlertTriangle size={12} /> Using platform default</span>;
  }
  return <span style={tag('var(--color-text-light)')}>Not configured</span>;
}

const tag = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600,
  padding: '3px 9px', borderRadius: 999, background: `${color}1A`, color,
});
