import React, { useCallback, useEffect, useState } from 'react';
import { Send, Trash2, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import {
  getAccountSmtpConfig, updateAccountSmtpConfig, deleteAccountSmtpConfig,
  sendTestEmail, getAccountConfigStatus,
} from '../../services/api';

const blank = {
  host: '', port: 587, username: '', password: '',
  use_tls: true, from_name: '', from_email: '', is_active: true,
};

export default function SmtpConfigTab({ onNotice }) {
  const [form, setForm] = useState(blank);
  const [hasPassword, setHasPassword] = useState(false);
  const [exists, setExists] = useState(false);
  const [source, setSource] = useState(null);   // account | platform | none
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, statusRes] = await Promise.all([getAccountSmtpConfig(), getAccountConfigStatus()]);
      const c = cfgRes.data;
      if (c) {
        setExists(true);
        setHasPassword(!!c.has_password);
        setForm({
          host: c.host || '', port: c.port || 587, username: c.username || '',
          password: '', use_tls: !!c.use_tls, from_name: c.from_name || '',
          from_email: c.from_email || '', is_active: !!c.is_active,
        });
      } else {
        setExists(false); setHasPassword(false); setForm(blank);
      }
      setSource(statusRes.data?.smtp?.source || 'none');
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to load SMTP config');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, port: Number(form.port) || 587 };
      // Don't overwrite the stored password with an empty box on an existing config.
      if (exists && hasPassword && !form.password) delete payload.password;
      await updateAccountSmtpConfig(payload);
      onNotice?.('success', 'SMTP configuration saved.');
      refresh();
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to save SMTP config');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove your SMTP configuration? Emails will fall back to the platform default.')) return;
    try {
      await deleteAccountSmtpConfig();
      onNotice?.('success', 'SMTP configuration removed.');
      refresh();
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to remove SMTP config');
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await sendTestEmail({});
      onNotice?.('success', r.data?.detail || 'Test email sent.');
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Test email failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="account-card"><div className="account-card-body">Loading…</div></div>;

  return (
    <div className="account-card">
      <div className="account-card-header">
        <h3><Send size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Email (SMTP)</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          Your own SMTP server is used to send your advisory-board emails (invites, reminders, minutes).
        </p>
      </div>
      <div className="account-card-body">
        <SourceBanner source={source} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <Field label="SMTP Host *">
            <input className="form-control" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.yourprovider.com" />
          </Field>
          <Field label="Port">
            <input type="number" className="form-control" value={form.port} onChange={(e) => set('port', e.target.value)} />
          </Field>
          <Field label="Username">
            <input className="form-control" value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </Field>
          <Field label={`Password ${hasPassword ? '(leave blank to keep)' : ''}`}>
            <input type="password" className="form-control" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={hasPassword ? '••••••••' : ''} autoComplete="new-password" />
          </Field>
          <Field label="From Name">
            <input className="form-control" value={form.from_name} onChange={(e) => set('from_name', e.target.value)} placeholder="Your Org Advisory Boards" />
          </Field>
          <Field label="From Email">
            <input className="form-control" value={form.from_email} onChange={(e) => set('from_email', e.target.value)} placeholder="no-reply@yourorg.com" />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.use_tls} onChange={(e) => set('use_tls', e.target.checked)} /> Use TLS (STARTTLS)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (use this config)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.host}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save configuration'}
          </button>
          <button className="btn btn-outline" onClick={test} disabled={testing}>
            <Send size={15} /> {testing ? 'Sending…' : 'Send test email'}
          </button>
          {exists && (
            <button className="btn btn-ghost" onClick={remove} style={{ color: 'var(--color-danger, var(--color-error))' }}>
              <Trash2 size={15} /> Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBanner({ source }) {
  if (source === 'account') {
    return (
      <div className="alert" style={bannerStyle('var(--color-success)')}>
        <CheckCircle size={16} /> Your emails are sent using <strong>your own SMTP</strong>.
      </div>
    );
  }
  if (source === 'platform') {
    return (
      <div className="alert" style={bannerStyle('var(--color-warning)')}>
        <AlertTriangle size={16} /> You haven't set up SMTP yet — emails currently use the <strong>platform default</strong>. Configure your own below.
      </div>
    );
  }
  return (
    <div className="alert" style={bannerStyle('var(--color-error)')}>
      <AlertTriangle size={16} /> No SMTP configured (yours or platform). Emails are logged but <strong>not delivered</strong> until you set this up.
    </div>
  );
}

const bannerStyle = (color) => ({
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
  padding: '10px 12px', borderRadius: 8, fontSize: '0.86rem',
  background: `${color}14`, color, border: `1px solid ${color}40`,
});

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
