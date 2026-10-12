import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, RefreshCw, AlertTriangle, CalendarClock, Table2, Search, LifeBuoy, XCircle, ListChecks,
} from 'lucide-react';
import { getWSUsage } from '../services/api';

const RANGES = [7, 30, 90];
const SERIES = [
  { key: 'serpapi', label: 'SerpAPI (Google)', color: 'var(--chart-serpapi)' },
  { key: 'fallback', label: 'Free fallback', color: 'var(--chart-fallback)' },
];
const PROVIDER = { serpapi: 'SerpAPI', brave: 'Brave', ddg: 'DuckDuckGo', scholar_direct: 'Scholar (direct)' };
const FEATURE = { find_kols: 'Find KOLs', scholar: 'Google Scholar' };

const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}) : '—');

// One SerpAPI account: live plan usage straight from SerpAPI.
function AccountCard({ a }) {
  if (a.error) {
    return (
      <div className="card" style={{ padding: '14px 18px' }}>
        <div style={{ fontWeight: 600 }}>{a.display_name} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>· {a.key}</span></div>
        <div style={{ marginTop: 6, color: 'var(--danger)', fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {a.error}
        </div>
      </div>
    );
  }
  const quota = (a.searches_per_month || 0) + (a.extra_credits || 0);
  const used = a.this_month_usage || 0;
  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const low = a.total_searches_left != null && quota && a.total_searches_left / quota < 0.1;
  return (
    <div className="card" style={{ padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{a.display_name}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {a.account_email} · {a.key} · used for {a.used_for.join(' + ')}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>{a.plan_name}</strong>{a.plan_monthly_price ? ` · $${a.plan_monthly_price}/mo` : ''}</div>
          {a.plan_renewal_date && <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><CalendarClock size={12} /> Renews {a.plan_renewal_date}</div>}
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{used.toLocaleString()}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>of {quota.toLocaleString()} searches used this month</span>
      </div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        style={{ height: 8, borderRadius: 4, background: 'var(--content-raised)', marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'var(--chart-serpapi)' }} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <span style={{ color: low ? 'var(--danger)' : undefined, fontWeight: low ? 600 : 400, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          {low && <AlertTriangle size={12} />}{(a.total_searches_left ?? 0).toLocaleString()} left
        </span>
        <span>This hour: {a.this_hour_searches ?? 0} / {a.account_rate_limit_per_hour ?? '—'}</span>
        {a.extra_credits > 0 && <span>Extra credits: {a.extra_credits}</span>}
        <span>Status: {a.account_status}</span>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="card" style={{ padding: '12px 16px', flex: '1 1 150px', minWidth: 0 }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Icon size={13} style={{ color: tone || 'var(--text-secondary)' }} /> {label}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 2 }}>{value.toLocaleString()}</div>
      {hint && <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{hint}</div>}
    </div>
  );
}

// Daily stacked bars: SerpAPI (bottom) + free fallback (top). Failures are not a
// series — they're a status, shown in the tile and the tooltip.
function DailyChart({ daily }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 170, padL = 30, padB = 22, padT = 8;
  const max = Math.max(1, ...daily.map((d) => d.serpapi + d.fallback));
  const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const plotW = W - padL, plotH = H - padB - padT;
  const slot = plotW / daily.length;
  const bw = Math.max(2, Math.min(22, slot - 4));
  const y = (v) => padT + plotH - (v / nice) * plotH;
  const labelEvery = Math.ceil(daily.length / 8);

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Searches per day, SerpAPI and free fallback"
        onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {[0, nice / 2, nice].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border-color)" strokeWidth={1} strokeDasharray={t ? '2 3' : undefined} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-secondary)">{t}</text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const hs = d.serpapi ? Math.max(2, y(0) - y(d.serpapi)) : 0;
          const hf = d.fallback ? Math.max(2, y(0) - y(d.fallback)) : 0;
          const gap = hs && hf ? 2 : 0;
          const r = Math.min(4, bw / 2);
          const seg = (top, h, color, rounded) => h > 0 && (
            <path fill={color} d={rounded
              ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`
              : `M${x},${top} H${x + bw} V${top + h} H${x} Z`} />
          );
          const topS = y(0) - hs;
          const topF = topS - gap - hf;
          return (
            <g key={d.date} opacity={hover && hover.date !== d.date ? 0.55 : 1}>
              {seg(topS, hs, 'var(--chart-serpapi)', !hf)}
              {seg(topF, hf, 'var(--chart-fallback)', true)}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-secondary)">{fmtDay(d.date)}</text>
              )}
              {/* Hit target: the whole column, not just the bar. */}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent"
                onMouseEnter={() => setHover({ ...d, left: ((padL + i * slot + slot / 2) / W) * 100 })} />
            </g>
          );
        })}
      </svg>
      {hover && (
        <div style={{
          position: 'absolute', top: 0, left: `${hover.left}%`, transform: `translateX(${hover.left > 70 ? '-105%' : '8px'})`,
          background: 'var(--content-card-bg)', border: '1px solid var(--border-color)', borderRadius: 6,
          padding: '8px 10px', fontSize: '0.78rem', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{fmtDay(hover.date)}</div>
          {SERIES.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
              <strong style={{ marginLeft: 'auto', paddingLeft: 10 }}>{hover[s.key]}</strong>
            </div>
          ))}
          {hover.failed > 0 && <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>Failed calls: <strong>{hover.failed}</strong></div>}
        </div>
      )}
    </div>
  );
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--border-color)' };
const td = { padding: '6px 8px', fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top' };

export default function SearchUsagePanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [asTable, setAsTable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getWSUsage(days);
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not load the usage report');
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-body" style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><BarChart3 size={18} /> Usage report</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {RANGES.map((r) => (
              <button key={r} className={`btn btn-sm ${days === r ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDays(r)}>
                {r} days
              </button>
            ))}
            <button className="btn btn-sm btn-ghost" onClick={load} title="Refresh" disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spinning' : ''} />
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error"><AlertTriangle size={14} /> {error}</div>}
        {!data && loading && <div className="loading-spinner"><div className="spinner" /></div>}

        {data && (
          <>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
              SerpAPI accounts — live from SerpAPI (checking this costs no search)
            </div>
            {data.accounts.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>No platform SerpAPI key configured.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 6 }}>
                {data.accounts.map((a) => <AccountCard key={a.config_id} a={a} />)}
              </div>
            )}
            {data.account_owned_keys > 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                {data.account_owned_keys} account(s) use their own SerpAPI key for Google Search — their searches are in the log below but not in the plan totals above.
              </p>
            )}

            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '18px 0 8px' }}>
              Searches made by this platform — last {data.days} days
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Tile icon={Search} label="SerpAPI searches" value={data.totals.serpapi}
                hint={Object.entries(data.serpapi_by_feature).map(([k, v]) => `${FEATURE[k] || k}: ${v}`).join(' · ') || null} tone="var(--chart-serpapi)" />
              <Tile icon={LifeBuoy} label="Free fallback used" value={data.totals.fallback} hint="Brave / DuckDuckGo / direct Scholar" tone="var(--chart-fallback)" />
              <Tile icon={XCircle} label="Failed calls" value={data.totals.failed} hint="quota, bad key or timeout" tone="var(--danger)" />
              <Tile icon={ListChecks} label="Results returned" value={data.totals.results} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
              {SERIES.map((s) => (
                <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} /> {s.label}
                </span>
              ))}
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setAsTable((v) => !v)}>
                {asTable ? <BarChart3 size={14} /> : <Table2 size={14} />} {asTable ? 'Chart' : 'Table'}
              </button>
            </div>
            {asTable ? (
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Date</th><th style={th}>SerpAPI</th><th style={th}>Free fallback</th><th style={th}>Failed</th></tr></thead>
                  <tbody>
                    {[...data.daily].reverse().map((d) => (
                      <tr key={d.date}><td style={td}>{fmtDay(d.date)}</td><td style={td}>{d.serpapi}</td><td style={td}>{d.fallback}</td><td style={td}>{d.failed}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <DailyChart daily={data.daily} />}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginTop: 18 }}>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>By user</div>
                {data.by_user.length === 0 ? <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>No searches yet.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>User</th><th style={th}>SerpAPI</th><th style={th}>All calls</th></tr></thead>
                    <tbody>
                      {data.by_user.map((u) => (
                        <tr key={u.user_id ?? 'none'}>
                          <td style={td}>{u.user_id ? <>{u.name}<div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem' }}>{u.email}</div></> : <span style={{ color: 'var(--text-secondary)' }}>System / background</span>}</td>
                          <td style={td}>{u.serpapi}</td><td style={td}>{u.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Recent calls</div>
                {data.recent.length === 0 ? <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>No searches yet.</p> : (
                  <div style={{ maxHeight: 300, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>When</th><th style={th}>Feature</th><th style={th}>Provider</th><th style={th}>Result</th></tr></thead>
                      <tbody>
                        {data.recent.map((r, i) => (
                          <tr key={i} title={r.query || ''}>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtTime(r.at)}</td>
                            <td style={td}>{FEATURE[r.feature] || r.feature}</td>
                            <td style={td}>{PROVIDER[r.provider] || r.provider}{r.key_scope === 'account' && <span style={{ color: 'var(--text-secondary)' }}> (own key)</span>}</td>
                            <td style={td}>
                              {r.status === 'ok' ? `${r.results} results`
                                : <span style={{ color: 'var(--danger)', display: 'inline-flex', gap: 4, alignItems: 'center' }} title={r.error || ''}><XCircle size={12} /> {r.status === 'quota' ? 'Quota / key' : 'Error'}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
