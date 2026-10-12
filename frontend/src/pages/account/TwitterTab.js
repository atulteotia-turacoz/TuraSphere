import React, { useCallback, useEffect, useState } from 'react';
import { Twitter, Trash2, Save, Wifi, CheckCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import {
  getMyTwitterConfig, saveMyTwitterConfig, deleteMyTwitterConfig,
  testMyTwitterConfig, getAccountConfigStatus,
} from '../../services/api';

const blank = {
  display_name: '', username: '', api_key: '', api_secret: '',
  bearer_token: '', access_token: '', access_token_secret: '',
  is_active: true,
};

// Secrets never come back from the server — only a masked preview. Leaving one
// blank on save keeps whatever is already stored.
const SECRETS = ['api_secret', 'bearer_token', 'access_token', 'access_token_secret'];

export default function TwitterTab({ onNotice }) {
  const [form, setForm] = useState(blank);
  const [cfg, setCfg] = useState(null);
  const [exists, setExists] = useState(false);
  const [source, setSource] = useState(null);   // account | platform | none
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const refresh = useCallback(async (reveal = false) => {
    setLoading(true);
    try {
      const [cfgRes, statusRes] = await Promise.all([
        getMyTwitterConfig(reveal), getAccountConfigStatus(),
      ]);
      const c = cfgRes.data || {};
      setCfg(c);
      if (c.id) {
        setExists(true);
        setForm({
          ...blank,
          display_name: c.display_name || '',
          username: c.username || '',
          api_key: c.api_key || '',
          is_active: c.is_active !== false,
          // Revealed => the server sent the real secrets; drop them into the boxes.
          // Otherwise leave them empty (empty = keep the stored value on save).
          ...(c.revealed ? {
            api_secret: c.api_secret || '',
            bearer_token: c.bearer_token || '',
            access_token: c.access_token || '',
            access_token_secret: c.access_token_secret || '',
          } : {}),
        });
      } else {
        setExists(false);
        setForm(blank);
      }
      setSource(statusRes.data?.twitter?.source || 'none');
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to load X (Twitter) config');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleReveal = async () => {
    const next = !revealed;
    setRevealed(next);
    await refresh(next);
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      SECRETS.forEach((k) => { if (!payload[k]) delete payload[k]; });
      await saveMyTwitterConfig(payload);
      onNotice?.('success', 'X (Twitter) integration saved.');
      refresh(revealed);
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to save X (Twitter) config');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Disconnect your X (Twitter) integration? Your account will fall back to the platform default.')) return;
    try {
      await deleteMyTwitterConfig();
      onNotice?.('success', 'X (Twitter) integration disconnected.');
      setRevealed(false); refresh(false);
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to disconnect');
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await testMyTwitterConfig();
      onNotice?.(r.data?.success ? 'success' : 'error', r.data?.message || 'Test complete.');
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  // An empty secret box means "keep what's stored" — so a saved secret must still
  // LOOK saved, or the form reads as though nothing was ever entered.
  const secretType = revealed ? 'text' : 'password';
  const dots = (has) => (revealed ? '' : has ? '••••••••' : '');
  const hint = (value, has) => {
    if (!has) return '';
    return revealed ? 'Shown in full — handle with care' : `Saved (${value}) — leave blank to keep`;
  };

  if (loading) return <div className="account-card"><div className="account-card-body">Loading…</div></div>;

  return (
    <div className="account-card">
      <div className="account-card-header">
        <h3><Twitter size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />X (Twitter)</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          Connect your X account so posts and engagement are published under your own handle.
        </p>
      </div>

      <div className="account-card-body">
        <SourceBanner source={source} username={cfg?.username} />

        {exists && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-sm btn-outline" onClick={toggleReveal}
              title={revealed ? 'Hide your stored secrets' : 'Show your stored secrets in full'}>
              {revealed ? <><EyeOff size={14} /> Hide secrets</> : <><Eye size={14} /> Show secrets</>}
            </button>
          </div>
        )}

        {revealed && (
          <div className="alert" style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
            background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', border: '1px solid var(--color-warning-bg)',
          }}>
            <AlertTriangle size={16} />
            <span>Your secrets are shown in full. Anyone looking at this screen can read them.</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <Field label="Handle (@username)">
            <input className="form-control" value={form.username} placeholder="yourhandle"
              onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label="Display Name">
            <input className="form-control" value={form.display_name} placeholder="e.g. My X App"
              onChange={(e) => set('display_name', e.target.value)} />
          </Field>
          <Field label="API Key (Consumer Key)">
            <input className="form-control" value={form.api_key} placeholder="X App API / Consumer Key"
              autoComplete="off" onChange={(e) => set('api_key', e.target.value)} />
          </Field>
          <Field label="API Secret (Secret Key)">
            <input type={secretType} className="form-control" value={form.api_secret}
              placeholder={dots(cfg?.has_api_secret)} autoComplete="new-password" spellCheck={false}
              onChange={(e) => set('api_secret', e.target.value)} />
            <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
              {hint(cfg?.api_secret, cfg?.has_api_secret)}
            </small>
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <Field label="Bearer Token">
            <input type={secretType} className="form-control" value={form.bearer_token}
              placeholder={cfg?.has_bearer_token ? dots(true) : 'App-only token — enough for read access'}
              autoComplete="new-password" spellCheck={false}
              onChange={(e) => set('bearer_token', e.target.value)} />
            <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
              {cfg?.has_bearer_token && <>{hint(cfg?.bearer_token, true)}<br /></>}
              Paste it <strong>exactly</strong> as the X Developer Portal shows it — including any{' '}
              <code>%2B</code> or <code>%3D</code>. Decoding those characters makes X reject the token.
            </small>
          </Field>
        </div>

        {/* Posting needs OAuth 1.0a user context, which the Bearer Token alone can't
            provide. Read-only integrations can leave this whole section empty. */}
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            Access Token &amp; Secret — optional, only needed to post
          </summary>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', margin: '8px 0 12px' }}>
            The API Key, Secret and Bearer Token above are enough for <strong>read</strong> access.
            To publish posts as @{form.username || 'yourhandle'} you also need an Access Token and
            Access Token Secret, generated from your app's <em>Keys and tokens</em> tab.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <Field label="Access Token">
              <input type={secretType} className="form-control" value={form.access_token}
                placeholder={dots(cfg?.has_access_token)} autoComplete="new-password" spellCheck={false}
                onChange={(e) => set('access_token', e.target.value)} />
              <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
                {hint(cfg?.access_token, cfg?.has_access_token)}
              </small>
            </Field>
            <Field label="Access Token Secret">
              <input type={secretType} className="form-control" value={form.access_token_secret}
                placeholder={dots(!!cfg?.access_token_secret)} autoComplete="new-password" spellCheck={false}
                onChange={(e) => set('access_token_secret', e.target.value)} />
              <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
                {hint(cfg?.access_token_secret, !!cfg?.access_token_secret)}
              </small>
            </Field>
          </div>
        </details>

        <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)} /> Active (use this integration)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save integration'}
          </button>
          <button className="btn btn-outline" onClick={test} disabled={testing}>
            <Wifi size={15} /> {testing ? 'Testing…' : 'Test connection'}
          </button>
          {exists && (
            <button className="btn btn-ghost" onClick={remove} style={{ color: 'var(--color-danger, var(--color-error))' }}>
              <Trash2 size={15} /> Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const bannerStyle = (color) => ({
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18,
  background: `${color}14`, color, border: `1px solid ${color}40`,
});

function SourceBanner({ source, username }) {
  if (source === 'account') {
    return (
      <div className="alert" style={bannerStyle('var(--color-success)')}>
        <CheckCircle size={16} />
        <span>
          Your X account{username ? <> (<strong>@{username}</strong>)</> : null} is connected.
        </span>
      </div>
    );
  }
  if (source === 'platform') {
    return (
      <div className="alert" style={bannerStyle('var(--color-warning)')}>
        <AlertTriangle size={16} />
        <span>
          You haven't connected X yet — posts would go out under the <strong>platform default</strong> account.
          Connect your own below.
        </span>
      </div>
    );
  }
  return (
    <div className="alert" style={bannerStyle('var(--color-error)')}>
      <AlertTriangle size={16} />
      <span>
        No X (Twitter) integration configured (yours or platform). Connect your account to enable posting.
      </span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="form-label" style={{ fontSize: '0.82rem' }}>{label}</label>
      {children}
    </div>
  );
}
