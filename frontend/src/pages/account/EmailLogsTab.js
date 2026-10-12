import React, { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { listAccountEmailLogs } from '../../services/api';

const PAGE = 50;

export default function EmailLogsTab({ onNotice }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (off) => {
    setLoading(true);
    try {
      const r = await listAccountEmailLogs({ limit: PAGE, offset: off });
      setItems(r.data?.items || []);
      setTotal(r.data?.total || 0);
      setOffset(off);
    } catch (e) {
      onNotice?.('error', e.response?.data?.detail || 'Failed to load email logs');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div className="account-card">
      <div className="account-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3><Mail size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Email Logs</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
            Every email sent from your account — delivery status, recipient and type. {total} total.
          </p>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => load(offset)}><RefreshCw size={14} /> Refresh</button>
      </div>
      <div className="account-card-body">
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>No emails sent yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-light)' }}>
                  <th style={th}>Status</th>
                  <th style={th}>Recipient</th>
                  <th style={th}>Subject</th>
                  <th style={th}>Type</th>
                  <th style={th}>Sent</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <td style={td}>
                      {l.success
                        ? <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> Sent</span>
                        : <span style={{ color: 'var(--color-error)', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={l.error || ''}><XCircle size={13} /> Failed</span>}
                    </td>
                    <td style={td}>{l.recipient_email}</td>
                    <td style={{ ...td, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.subject}</td>
                    <td style={td}><span style={{ fontSize: '0.72rem', background: 'var(--color-bg-muted,var(--color-surface-raised))', padding: '2px 7px', borderRadius: 999 }}>{l.kind}</span></td>
                    <td style={td}>{l.sent_at ? new Date(l.sent_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <button className="btn btn-sm btn-ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE))}>Previous</button>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
            <button className="btn btn-sm btn-ghost" disabled={offset + PAGE >= total} onClick={() => load(offset + PAGE)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

const th = { padding: '8px 10px', fontWeight: 600 };
const td = { padding: '8px 10px' };
