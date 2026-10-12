import React, { useEffect, useState } from 'react';
import {
  Shield, Video, Plus, Trash2, Edit3, CheckCircle, X, Save, Power, Mail, Send, RefreshCw,
} from 'lucide-react';
import {
  listMeetingProviderConfigs, upsertMeetingProviderConfig, deleteMeetingProviderConfig,
  listMabmRoleAssignments, createMabmRoleAssignment, updateMabmRoleAssignment, deleteMabmRoleAssignment,
  sendMeetingReminders, sendManuscriptPings, listEmailLog,
} from '../../services/api';

const MABM_ROLES = [
  { id: 'super_admin',    label: 'Super Admin',     desc: 'Full MABM access' },
  { id: 'sub_admin',      label: 'Sub Admin',       desc: 'Delegated admin (granular permissions)' },
  { id: 'medical_writer', label: 'Medical Writer',  desc: 'Edit transcripts, draft minutes/manuscripts' },
  { id: 'turacoz_team',   label: 'Turacoz Team',    desc: 'Internal Turacoz operator' },
];
const ROLE_LABEL = Object.fromEntries(MABM_ROLES.map(r => [r.id, r.label]));

const SUB_TABS = [
  { id: 'provider', label: 'Meeting Provider', icon: Video },
  { id: 'roles',    label: 'MABM Roles',       icon: Shield },
  { id: 'jobs',     label: 'Email & Jobs',     icon: Mail },
];

export default function MabmAdminTab() {
  const [sub, setSub] = useState('provider');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--color-border-light)' }}>
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = sub === t.id;
          return (
            <button key={t.id} onClick={() => setSub(t.id)} style={{
              padding: '10px 16px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
              color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', marginBottom: -1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
      {sub === 'provider' && <ProviderConfigSection />}
      {sub === 'roles'    && <RolesSection />}
      {sub === 'jobs'     && <JobsSection />}
    </div>
  );
}

// ── Email & Jobs section ─────────────────────────────────

function JobsSection() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [running, setRunning] = useState(null);   // 'reminders' | 'pings' | null
  const [lastResult, setLastResult] = useState(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setLogs((await listEmailLog({ limit: 100 })).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const runReminders = async () => {
    setRunning('reminders'); setLastResult(null);
    try { setLastResult((await sendMeetingReminders()).data); load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setRunning(null); }
  };
  const runPings = async () => {
    setRunning('pings'); setLastResult(null);
    try { setLastResult((await sendManuscriptPings()).data); load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setRunning(null); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Email Automation & Jobs</h3>
        <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          Trigger the cron-callable email jobs manually, and audit recent deliveries.
          For production, point an external cron at <code>POST /jobs/send-meeting-reminders</code> (every 30 min)
          and <code>POST /jobs/send-manuscript-pings</code> (daily).
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Send size={16} style={{ color: 'var(--color-info)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Meeting Reminders</h4>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
            Sends 24h and 1h reminders for upcoming scheduled meetings. Idempotent.
          </p>
          <button className="btn btn-sm btn-primary" onClick={runReminders} disabled={running !== null}>
            {running === 'reminders' ? 'Running…' : 'Run now'}
          </button>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <RefreshCw size={16} style={{ color: 'var(--color-success)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Manuscript Pings</h4>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
            15-day status updates for non-terminal manuscripts (per the MABM spec).
          </p>
          <button className="btn btn-sm btn-primary" onClick={runPings} disabled={running !== null}>
            {running === 'pings' ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>

      {lastResult && (
        <div style={{ marginBottom: 16, padding: 12, background: 'var(--color-success-bg)', color: 'var(--color-success-text)', borderRadius: 6, fontSize: '0.85rem' }}>
          <strong>Run complete.</strong> {Object.entries(lastResult).filter(([k]) => k !== 'detail').map(([k, v]) => `${k}: ${v}`).join(' • ')}
        </div>
      )}
      {err && (
        <div style={{ marginBottom: 16, padding: 12, background: 'var(--color-error-bg)', color: 'var(--color-error-text)', borderRadius: 6, fontSize: '0.85rem' }}>{err}</div>
      )}

      {/* Email log */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Recent Email Log</h4>
          <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-light)' }}>
            No emails sent yet. Run a job above or trigger an action that emails participants (share minutes, change manuscript status, etc.).
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
                <Th>When</Th><Th>Kind</Th><Th>Recipient</Th><Th>Subject</Th><Th align="center">OK</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  <Td>{new Date(l.sent_at).toLocaleString()}</Td>
                  <Td><code style={{ fontSize: '0.74rem' }}>{l.kind}</code></Td>
                  <Td>{l.recipient_email}</Td>
                  <Td>{l.subject}</Td>
                  <Td align="center">
                    {l.success ? <CheckCircle size={14} style={{ color: 'var(--color-success)' }} /> : <X size={14} style={{ color: 'var(--color-error)' }} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Provider Config ──────────────────────────────────────

function ProviderConfigSection() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);   // 'teams' | 'zoom' | null

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await listMeetingProviderConfigs();
      setConfigs(r.data || []);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const byProvider = (p) => configs.find(c => c.provider === p);

  const remove = async (cfg) => {
    if (!window.confirm(`Delete the ${cfg.provider} configuration?`)) return;
    try { await deleteMeetingProviderConfig(cfg.id); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Meeting Provider Configuration</h3>
        <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          Pick which platform handles MABM meetings. Only one provider can be active at a time.
          Credentials are stored in the database — the actual integration ships in Phase 4.
        </p>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</div>
      ) : err ? (
        <div className="card" style={{ padding: 16, borderLeft: '3px solid var(--color-error)' }}>
          <strong>Couldn't load provider config.</strong>
          <div style={{ fontSize: '0.84rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>{err}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          {['zoom', 'teams'].map(provider => {
            const cfg = byProvider(provider);
            const isEditing = editing === provider;
            if (isEditing) {
              return (
                <ProviderForm
                  key={provider}
                  provider={provider}
                  initial={cfg}
                  onCancel={() => setEditing(null)}
                  onSaved={() => { setEditing(null); load(); }}
                />
              );
            }
            return (
              <ProviderCard
                key={provider}
                provider={provider}
                cfg={cfg}
                onEdit={() => setEditing(provider)}
                onDelete={() => cfg && remove(cfg)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, cfg, onEdit, onDelete }) {
  const recommended = provider === 'zoom';
  const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';
  const webhookUrl = `${apiBase}/webhooks/zoom`;
  const webhookSecretSet = !!(cfg?.extra_config?.webhook_secret);

  return (
    <div className="card" style={{ padding: 18, borderLeft: cfg?.is_active ? '3px solid var(--color-success)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: provider === 'zoom' ? '#2D8CFF1A' : '#5059C91A', color: provider === 'zoom' ? '#2D8CFF' : '#5059C9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Video size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: 0, fontSize: '1rem', textTransform: 'capitalize' }}>{provider}</h4>
          {recommended && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>Phase 4 active integration</div>}
        </div>
        {cfg?.is_active && (
          <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>
            <CheckCircle size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            Active
          </span>
        )}
      </div>
      {cfg ? (
        <>
          <Field label="Client ID" value={cfg.client_id || '—'} />
          <Field label="Client Secret" value={cfg.has_client_secret ? cfg.client_secret : '— (not set)'} mono />
          {provider === 'zoom' && <Field label="Account ID" value={cfg.account_id || '—'} />}
          {provider === 'teams' && <Field label="Tenant ID" value={cfg.tenant_id || '—'} />}
          {provider === 'zoom' && (
            <>
              <Field label="Webhook Secret" value={webhookSecretSet ? '****  (set)' : '— (not set — webhooks won\'t be verified)'} />
              <div style={{ marginTop: 10, padding: 10, background: 'var(--color-bg)', borderRadius: 6, fontSize: '0.78rem' }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>Zoom Webhook URL</div>
                <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.75rem' }}>{webhookUrl}</code>
                <div style={{ marginTop: 6, color: 'var(--color-text-light)' }}>
                  Paste into Zoom Marketplace → your app → Feature → Event Subscriptions. Subscribe to <code>recording.completed</code> and <code>meeting.ended</code>.
                </div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button className="btn btn-sm btn-outline" onClick={onEdit}><Edit3 size={12} /> Edit</button>
            <button className="btn btn-sm btn-ghost" onClick={onDelete} style={{ color: 'var(--color-error)' }}><Trash2 size={12} /></button>
          </div>
        </>
      ) : (
        <div>
          <p style={{ margin: '0 0 12px', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>
            Not configured.
          </p>
          <button className="btn btn-sm btn-primary" onClick={onEdit}>
            <Plus size={12} /> Configure {provider}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.86rem', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  );
}

function ProviderForm({ provider, initial, onCancel, onSaved }) {
  const [clientId, setClientId] = useState(initial?.client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState(initial?.tenant_id || '');
  const [accountId, setAccountId] = useState(initial?.account_id || '');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isActive, setIsActive] = useState(initial?.is_active ?? (provider === 'zoom'));
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const existingExtra = initial?.extra_config || {};
  const hasWebhookSecret = !!existingExtra.webhook_secret;
  const [organizerUserId, setOrganizerUserId] = useState(existingExtra.organizer_user_id || '');

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setSaving(true);
    try {
      // Merge webhook_secret into extra_config; only include if user typed a new one
      const newExtra = { ...existingExtra };
      if (webhookSecret) newExtra.webhook_secret = webhookSecret;
      if (provider === 'teams') newExtra.organizer_user_id = organizerUserId.trim() || undefined;

      const payload = {
        provider,
        is_active: isActive,
        client_id: clientId.trim() || null,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        tenant_id: provider === 'teams' ? (tenantId.trim() || null) : null,
        account_id: provider === 'zoom' ? (accountId.trim() || null) : null,
        extra_config: Object.keys(newExtra).length ? newExtra : null,
      };
      await upsertMeetingProviderConfig(payload);
      onSaved();
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: '1rem', textTransform: 'capitalize' }}>Configure {provider}</h4>
        <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>
      <FormField label="Client ID">
        <input className="form-control" value={clientId} onChange={e => setClientId(e.target.value)} autoFocus />
      </FormField>
      <FormField label={`Client Secret ${initial?.has_client_secret ? '(leave blank to keep existing)' : ''}`}>
        <input className="form-control" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={initial?.has_client_secret ? '••••••••' : ''} />
      </FormField>
      {provider === 'zoom' && (
        <>
          <FormField label="Account ID (Server-to-Server OAuth)">
            <input className="form-control" value={accountId} onChange={e => setAccountId(e.target.value)} />
          </FormField>
          <FormField label={`Webhook Secret Token ${hasWebhookSecret ? '(leave blank to keep existing)' : ''}`}>
            <input className="form-control" type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={hasWebhookSecret ? '••••••••' : 'From Zoom Marketplace → Feature → Event Subscriptions'} />
          </FormField>
        </>
      )}
      {provider === 'teams' && (
        <>
          <FormField label="Tenant ID">
            <input className="form-control" value={tenantId} onChange={e => setTenantId(e.target.value)} />
          </FormField>
          <FormField label="Organizer User ID (AAD object id)">
            <input className="form-control" value={organizerUserId} onChange={e => setOrganizerUserId(e.target.value)}
              placeholder="The Azure AD user the Teams meetings are created for" />
          </FormField>
        </>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: '0.88rem' }}>
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        <Power size={14} /> Make this the active meeting provider (deactivates the other)
      </label>
      {err && <div style={{ marginTop: 10, background: 'var(--color-error-bg)', color: 'var(--color-error-text)', padding: 10, borderRadius: 6, fontSize: '0.83rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
          <Save size={12} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

// ── MABM Roles ───────────────────────────────────────────

function RolesSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [granting, setGranting] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await listMabmRoleAssignments();
      setRows(r.data || []);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (ra) => {
    try { await updateMabmRoleAssignment(ra.id, { is_active: !ra.is_active }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const updatePerms = async (ra, perms) => {
    try { await updateMabmRoleAssignment(ra.id, { permissions: perms }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const remove = async (ra) => {
    if (!window.confirm(`Remove ${ROLE_LABEL[ra.role]} from ${ra.user_name || `user #${ra.user_id}`}?`)) return;
    try { await deleteMabmRoleAssignment(ra.id); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>MABM Module Roles</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            Module-level roles, separate from the platform's global super_admin/admin/user.
            Per-meeting roles (panel/participant) are assigned per meeting, not here.
          </p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setGranting(true)}>
          <Plus size={14} /> Grant Role
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</div>
      ) : err ? (
        <div className="card" style={{ padding: 16, borderLeft: '3px solid var(--color-error)' }}>
          <strong>Couldn't load role assignments.</strong>
          <div style={{ fontSize: '0.84rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>{err}</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <Shield size={28} style={{ color: 'var(--color-text-light)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 12px', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
            No MABM roles granted yet.
          </p>
          <button className="btn btn-sm btn-primary" onClick={() => setGranting(true)}>
            <Plus size={13} /> Grant the first role
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
                <Th>User</Th><Th>Role</Th><Th>Permissions</Th><Th>Granted</Th><Th align="center">Active</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map(ra => (
                <RoleRow
                  key={ra.id}
                  ra={ra}
                  onToggleActive={() => toggleActive(ra)}
                  onUpdatePerms={(perms) => updatePerms(ra, perms)}
                  onDelete={() => remove(ra)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {granting && (
        <GrantRoleModal
          existing={rows}
          onClose={() => setGranting(false)}
          onGranted={() => { setGranting(false); load(); }}
        />
      )}
    </div>
  );
}

function RoleRow({ ra, onToggleActive, onUpdatePerms, onDelete }) {
  const [editingPerms, setEditingPerms] = useState(false);
  const [draft, setDraft] = useState((ra.permissions || []).join(', '));
  const isSubAdmin = ra.role === 'sub_admin';

  const save = () => {
    const perms = draft.split(',').map(s => s.trim()).filter(Boolean);
    onUpdatePerms(perms);
    setEditingPerms(false);
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border-light)', opacity: ra.is_active ? 1 : 0.55 }}>
      <Td>
        <div style={{ fontWeight: 600 }}>{ra.user_name || `User #${ra.user_id}`}</div>
        {ra.user_email && <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{ra.user_email}</div>}
      </Td>
      <Td>
        <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', fontWeight: 600, fontSize: '0.78rem' }}>
          {ROLE_LABEL[ra.role] || ra.role}
        </span>
      </Td>
      <Td>
        {isSubAdmin ? (
          editingPerms ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="form-control" value={draft} onChange={e => setDraft(e.target.value)}
                placeholder="meetings.create, documents.manage" style={{ fontSize: '0.78rem', padding: '4px 6px' }} />
              <button className="btn btn-sm btn-primary" onClick={save}>Save</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setEditingPerms(false); setDraft((ra.permissions || []).join(', ')); }}>×</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                {(ra.permissions || []).length === 0 ? <em>(none)</em> : (ra.permissions || []).join(', ')}
              </span>
              <button onClick={() => setEditingPerms(true)} title="Edit permissions" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                <Edit3 size={12} />
              </button>
            </div>
          )
        ) : (
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>n/a</span>
        )}
      </Td>
      <Td>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
          {ra.granted_at ? new Date(ra.granted_at).toLocaleDateString() : '—'}
        </span>
      </Td>
      <Td align="center">
        <button onClick={onToggleActive} title={ra.is_active ? 'Deactivate' : 'Activate'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <Power size={14} style={{ color: ra.is_active ? 'var(--color-success)' : 'var(--color-text-light)' }} />
        </button>
      </Td>
      <Td align="right">
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 4 }}>
          <Trash2 size={14} />
        </button>
      </Td>
    </tr>
  );
}

function GrantRoleModal({ existing, onClose, onGranted }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('medical_writer');
  const [perms, setPerms] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!userId) { setErr('User ID is required'); return; }
    setErr(null); setSaving(true);
    try {
      const payload = {
        user_id: Number(userId),
        role,
        permissions: role === 'sub_admin' ? perms.split(',').map(s => s.trim()).filter(Boolean) : null,
      };
      await createMabmRoleAssignment(payload);
      onGranted();
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message);
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: 460, width: '100%', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--color-border-light)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Grant MABM Role</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormField label="User ID (numeric)">
            <input className="form-control" type="number" value={userId} onChange={e => setUserId(e.target.value)} autoFocus />
            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', marginTop: 4 }}>
              The platform users.id for the person. (User search by email lands in a future polish pass.)
            </div>
          </FormField>
          <FormField label="MABM Role">
            <select className="form-control" value={role} onChange={e => setRole(e.target.value)}>
              {MABM_ROLES.map(r => (
                <option key={r.id} value={r.id}>{r.label} — {r.desc}</option>
              ))}
            </select>
          </FormField>
          {role === 'sub_admin' && (
            <FormField label="Permissions (comma-separated capability slugs)">
              <input className="form-control" value={perms} onChange={e => setPerms(e.target.value)}
                placeholder="meetings.create, documents.manage, manuscripts.review" />
            </FormField>
          )}
          {err && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error-text)', padding: 10, borderRadius: 6, fontSize: '0.83rem' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
              <Plus size={12} /> {saving ? 'Granting…' : 'Grant Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const Th = ({ children, align = 'left' }) => (
  <th style={{ padding: '10px 14px', textAlign: align, fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>
);
const Td = ({ children, align = 'left' }) => (
  <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'top' }}>{children}</td>
);
