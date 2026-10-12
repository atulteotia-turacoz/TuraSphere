import React, { useEffect, useState } from 'react';
import { Mail, X, Check, Save, Server, Video, Edit2, Trash2, Power } from 'lucide-react';
import {
  getGlobalSmtpConfig, updateGlobalSmtpConfig, listAllSmtpConfigs, listAllMeetingProviders,
  updateSmtpConfig, toggleSmtpConfig, deleteSmtpConfig,
} from '../services/api';

export default function SmtpConfigPage() {
  const [form, setForm] = useState({
    host: '', port: 587, username: '', password: '',
    use_tls: true, from_name: '', from_email: '', is_active: true,
  });
  const [hasPassword, setHasPassword] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [g, all, prov] = await Promise.all([
        getGlobalSmtpConfig(), listAllSmtpConfigs(), listAllMeetingProviders(),
      ]);
      if (g.data) {
        setHasPassword(!!g.data.password);
        setForm({
          host: g.data.host || '', port: g.data.port || 587, username: g.data.username || '',
          password: '', use_tls: !!g.data.use_tls, from_name: g.data.from_name || '',
          from_email: g.data.from_email || '', is_active: !!g.data.is_active,
        });
      }
      setAccounts(all.data || []);
      setProviders(prov.data || []);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load SMTP configuration');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const payload = { ...form, port: Number(form.port) || 587 };
      if (hasPassword && !form.password) delete payload.password;
      await updateGlobalSmtpConfig(payload);
      setSuccess('Platform default SMTP saved.');
      load();
    } catch (e) {
      setError(e.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Per-account SMTP row actions ──
  const [editing, setEditing] = useState(null);   // the config row being edited (or null)
  const [editSaving, setEditSaving] = useState(false);

  const toggle = async (c) => {
    setError(''); setSuccess('');
    try {
      await toggleSmtpConfig(c.id);
      setSuccess(`${c.owner_email || 'Platform'} SMTP ${c.is_active ? 'deactivated' : 'activated'}.`);
      load();
    } catch (e) { setError(e.response?.data?.detail || 'Could not change status'); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete the SMTP config for ${c.owner_email || 'platform default'}? This cannot be undone.`)) return;
    setError(''); setSuccess('');
    try {
      await deleteSmtpConfig(c.id);
      setSuccess('SMTP config deleted.');
      load();
    } catch (e) { setError(e.response?.data?.detail || 'Delete failed'); }
  };

  const saveEdit = async (payload) => {
    setEditSaving(true); setError(''); setSuccess('');
    try {
      await updateSmtpConfig(editing.id, payload);
      setEditing(null);
      setSuccess('SMTP config updated.');
      load();
    } catch (e) { setError(e.response?.data?.detail || 'Update failed'); }
    finally { setEditSaving(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><Mail size={24} /> SMTP / Email</h1>
          <p className="page-subtitle">
            The platform default mail server (used when an account hasn't set up its own) + oversight of every account's config.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-danger"><X size={16} /> {error}</div>}
      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}

      {/* Global default form */}
      <div className="config-card" style={{ borderTop: '3px solid var(--primary)', maxWidth: 720 }}>
        <div className="config-card-header"><h3 style={{ margin: 0 }}><Server size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Platform default SMTP</h3></div>
        <div className="config-card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Field label="Host"><input className="form-input" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.provider.com" /></Field>
          <Field label="Port"><input type="number" className="form-input" value={form.port} onChange={(e) => set('port', e.target.value)} /></Field>
          <Field label="Username"><input className="form-input" value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></Field>
          <Field label={`Password ${hasPassword ? '(leave blank to keep)' : ''}`}><input type="password" className="form-input" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={hasPassword ? '••••••••' : ''} autoComplete="new-password" /></Field>
          <Field label="From Name"><input className="form-input" value={form.from_name} onChange={(e) => set('from_name', e.target.value)} /></Field>
          <Field label="From Email"><input className="form-input" value={form.from_email} onChange={(e) => set('from_email', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '0 16px 12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.86rem' }}>
            <input type="checkbox" checked={form.use_tls} onChange={(e) => set('use_tls', e.target.checked)} /> Use TLS
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.86rem' }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active
          </label>
        </div>
        <div className="config-card-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px' }}>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !form.host}><Save size={14} /> {saving ? 'Saving…' : 'Save default'}</button>
        </div>
      </div>

      {/* Oversight + management: every account's SMTP */}
      <h2 style={{ fontSize: '1rem', margin: '24px 0 10px' }}>All account SMTP configs</h2>
      <OversightTable
        loading={loading}
        rows={accounts}
        cols={['Scope', 'Account', 'Host', 'From', 'Active']}
        render={(c) => [
          c.scope, c.owner_email || '— (platform)', c.host || '—',
          c.from_email || '—', c.is_active ? 'Yes' : 'No',
        ]}
        actions={(c) => (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-xs" title={c.is_active ? 'Deactivate' : 'Activate'} onClick={() => toggle(c)}
              style={{ color: c.is_active ? 'var(--success)' : 'var(--text-muted)' }}>
              <Power size={14} />
            </button>
            <button className="btn btn-xs" title="Edit" onClick={() => setEditing(c)}><Edit2 size={14} /></button>
            <button className="btn btn-xs" title="Delete" onClick={() => remove(c)} style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
          </div>
        )}
        empty="No SMTP configs yet."
      />

      {editing && (
        <EditSmtpModal
          config={editing}
          saving={editSaving}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}

      {/* Oversight: every account's meeting providers */}
      <h2 style={{ fontSize: '1rem', margin: '24px 0 10px' }}><Video size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> All meeting-platform configs</h2>
      <OversightTable
        loading={loading}
        rows={providers}
        cols={['Scope', 'Account', 'Provider', 'Configured', 'Active']}
        render={(c) => [
          c.scope, c.owner_email || '— (platform)', c.provider,
          c.configured ? 'Yes' : 'No', c.is_active ? 'Yes' : 'No',
        ]}
        empty="No meeting-platform configs yet."
      />
    </div>
  );
}

function OversightTable({ loading, rows, cols, render, empty, actions }) {
  if (loading) return <div className="config-card"><div className="config-card-body">Loading…</div></div>;
  if (!rows.length) return <div className="config-card"><div className="config-card-body" style={{ color: 'var(--text-muted)' }}>{empty}</div></div>;
  return (
    <div className="config-card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            {cols.map((c) => <th key={c} style={{ padding: '8px 12px' }}>{c}</th>)}
            {actions && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} style={{ borderBottom: '1px solid var(--content-raised)' }}>
              {render(r).map((cell, j) => (
                <td key={j} style={{ padding: '8px 12px' }}>
                  {j === 0
                    ? <span className={`badge ${cell === 'platform' ? 'badge-secondary' : 'badge-success'}`}>{cell}</span>
                    : cell}
                </td>
              ))}
              {actions && <td style={{ padding: '8px 12px' }}>{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditSmtpModal({ config, saving, onCancel, onSave }) {
  const [f, setF] = useState({
    host: config.host || '', port: config.port || 587, username: config.username || '',
    password: '', use_tls: !!config.use_tls, from_name: config.from_name || '',
    from_email: config.from_email || '', is_active: !!config.is_active,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => {
    const payload = { ...f, port: Number(f.port) || 587 };
    if (!payload.password) delete payload.password;   // blank = keep existing
    onSave(payload);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onCancel}>
      <div className="config-card" style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="config-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Edit SMTP — {config.owner_email || 'Platform default'}</h3>
          <button className="btn btn-xs" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="config-card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Field label="Host"><input className="form-input" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.provider.com" /></Field>
          <Field label="Port"><input type="number" className="form-input" value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
          <Field label="Username"><input className="form-input" value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></Field>
          <Field label="Password (leave blank to keep)"><input type="password" className="form-input" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" autoComplete="new-password" /></Field>
          <Field label="From Name"><input className="form-input" value={f.from_name} onChange={(e) => set('from_name', e.target.value)} /></Field>
          <Field label="From Email"><input className="form-input" value={f.from_email} onChange={(e) => set('from_email', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '0 16px 12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.86rem' }}>
            <input type="checkbox" checked={f.use_tls} onChange={(e) => set('use_tls', e.target.checked)} /> Use TLS
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.86rem' }}>
            <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active
          </label>
        </div>
        <div className="config-card-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px' }}>
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={saving || !f.host}><Save size={14} /> {saving ? 'Saving…' : 'Save changes'}</button>
        </div>
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
