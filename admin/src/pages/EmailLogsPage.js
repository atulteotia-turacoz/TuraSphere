import React, { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, CheckCircle, XCircle, X } from 'lucide-react';
import { listAllEmailLogs } from '../services/api';

const PAGE = 50;
const KINDS = [
  '', 'kol_invite', 'meeting_reminder_24h', 'meeting_reminder_1h', 'minutes_shared',
  'minutes_finalized', 'manuscript_status_change', 'manuscript_15day_ping',
  'document_review', 'report_review', 'survey_reminder', 'other',
];

export default function EmailLogsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState('');     // '' | 'true' | 'false'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (off) => {
    setLoading(true); setError('');
    try {
      const params = { limit: PAGE, offset: off };
      if (kind) params.kind = kind;
      if (ownerId) params.owner_user_id = Number(ownerId);
      if (status) params.success = status;
      const r = await listAllEmailLogs(params);
      setItems(r.data?.items || []);
      setTotal(r.data?.total || 0);
      setOffset(off);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load email logs');
    } finally {
      setLoading(false);
    }
  }, [kind, ownerId, status]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><Mail size={24} /> Email Logs</h1>
          <p className="page-subtitle">Every email sent across all accounts — delivery status, recipient, and owning account.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger"><X size={16} /> {error}</div>}

      <div className="config-card" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Type">
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{k || 'All types'}</option>)}
          </select>
        </Field>
        <Field label="Account user ID">
          <input className="form-input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="e.g. 42" style={{ width: 120 }} />
        </Field>
        <Field label="Status">
          <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="true">Sent</option>
            <option value="false">Failed</option>
          </select>
        </Field>
        <button className="btn btn-sm btn-secondary" onClick={() => load(0)}><RefreshCw size={14} /> Apply</button>
      </div>

      <div className="config-card" style={{ overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>No emails match.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={th}>Status</th><th style={th}>Account</th><th style={th}>Recipient</th>
                <th style={th}>Subject</th><th style={th}>Type</th><th style={th}>Sent</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--content-raised)' }}>
                  <td style={td}>
                    {l.success
                      ? <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> Sent</span>
                      : <span style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={l.error || ''}><XCircle size={13} /> Failed</span>}
                  </td>
                  <td style={td}>{l.owner_email || '— (platform)'}</td>
                  <td style={td}>{l.recipient_email}</td>
                  <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.subject}</td>
                  <td style={td}>{l.kind}</td>
                  <td style={td}>{l.sent_at ? new Date(l.sent_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button className="btn btn-sm btn-secondary" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE))}>Previous</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <button className="btn btn-sm btn-secondary" disabled={offset + PAGE >= total} onClick={() => load(offset + PAGE)}>Next</button>
        </div>
      )}
    </div>
  );
}

const th = { padding: '8px 12px', fontWeight: 600 };
const td = { padding: '8px 12px' };

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
