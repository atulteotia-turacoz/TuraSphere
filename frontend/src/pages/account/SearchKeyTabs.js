import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Globe, BookOpen, Save, Wifi, Trash2, CheckCircle, AlertTriangle, Info, RefreshCw, XCircle,
} from 'lucide-react';
import {
  getMyWebSearchConfig, saveMyWebSearchConfig, deleteMyWebSearchConfig, testMyWebSearchConfig,
  getMyWebSearchUsage,
  getMyScholarConfig, saveMyScholarConfig, deleteMyScholarConfig, testMyScholarConfig,
} from '../../services/api';

// Account → Google Search / Google Scholar. Same rule as Account → X (Twitter):
// your own key is used first; without one, the platform's key (set by the super
// admin); and when no key works, a free fallback — so searching never stops.

const bannerStyle = (color) => ({
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18,
  background: `${color}14`, color, border: `1px solid ${color}40`,
});

function SourceBanner({ source, what }) {
  if (source === 'account') {
    return (
      <div className="alert" style={bannerStyle('var(--color-success)')}>
        <CheckCircle size={16} /> <span>{what} uses <strong>your own</strong> setting.</span>
      </div>
    );
  }
  if (source === 'platform') {
    return (
      <div className="alert" style={bannerStyle('var(--color-info)')}>
        <Info size={16} /> <span>You haven't set up your own yet — {what} is using the <strong>platform (admin) setting</strong>. Add your own below to use your SerpAPI quota instead.</span>
      </div>
    );
  }
  return (
    <div className="alert" style={bannerStyle('var(--color-warning)')}>
      <AlertTriangle size={16} />
      <span>No SerpAPI key (yours or platform) — {what} runs on the <strong>free fallback</strong>, which is slower and less reliable.</span>
    </div>
  );
}

function useKeyTab({ load, save, remove, test, onNotice: notice, label }) {
  // The parent passes a fresh inline onNotice each render; a ref keeps `refresh`
  // stable so a notice doesn't trigger a reload.
  const noticeRef = useRef(notice);
  noticeRef.current = notice;
  const onNotice = (...a) => noticeRef.current?.(...a);
  const [cfg, setCfg] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [active, setActive] = useState(true);
  const [provider, setProvider] = useState('serpapi');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await load();
      setCfg(r.data);
      setActive(r.data.is_active !== false);
      setProvider(r.data.provider || 'serpapi');
      setApiKey('');
    } catch (e) {
      noticeRef.current?.('error', e.response?.data?.detail || `Failed to load ${label}`);
    }
  }, [load, label]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (name, fn, okMsg) => {
    setBusy(name);
    try {
      const r = await fn();
      if (name === 'test') onNotice(r.data?.success ? 'success' : 'error', r.data?.message || 'Test complete.');
      else { onNotice('success', okMsg); await refresh(); }
    } catch (e) {
      onNotice('error', e.response?.data?.detail || `${label}: request failed`);
    } finally { setBusy(''); }
  };

  return {
    cfg, apiKey, setApiKey, active, setActive, provider, setProvider, busy,
    doSave: () => run('save', () => save({ api_key: apiKey || null, is_active: active, provider }), `${label} saved.`),
    doTest: () => run('test', test),
    doRemove: () => {
      if (!window.confirm(`Remove your ${label} key? The platform setting will be used again.`)) return;
      run('remove', remove, `${label} key removed.`);
    },
  };
}

function KeyForm({ t, showProvider }) {
  const needsKey = !showProvider || t.provider === 'serpapi';
  return (
    <>
      {showProvider && (
        <div style={{ marginBottom: 14 }}>
          <label className="form-label" style={{ fontSize: '0.82rem' }}>Mode</label>
          <select className="form-control" style={{ maxWidth: 360 }} value={t.provider} onChange={(e) => t.setProvider(e.target.value)}>
            <option value="serpapi">SerpAPI — my own key (reliable)</option>
            <option value="direct">Direct — scrape Google Scholar (free, may be rate-limited)</option>
          </select>
        </div>
      )}
      {needsKey && (
        <div style={{ maxWidth: 480 }}>
          <label className="form-label" style={{ fontSize: '0.82rem' }}>SerpAPI Key</label>
          <input className="form-control" type="password" autoComplete="new-password" spellCheck={false}
            value={t.apiKey} onChange={(e) => t.setApiKey(e.target.value)}
            placeholder={t.cfg?.api_key_masked ? '••••••••' : 'Your SerpAPI key'} />
          <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
            {t.cfg?.api_key_masked ? `Saved (${t.cfg.api_key_masked}) — leave blank to keep. ` : ''}
            From serpapi.com → Dashboard → API Key. The same key can be used for Google Search and Google Scholar.
          </small>
        </div>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', cursor: 'pointer', marginTop: 14 }}>
        <input type="checkbox" checked={t.active} onChange={(e) => t.setActive(e.target.checked)} /> Active (use my setting)
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={t.doSave} disabled={!!t.busy}>
          <Save size={15} /> {t.busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {t.cfg?.configured && (
          <button className="btn btn-outline" onClick={t.doTest} disabled={!!t.busy}>
            <Wifi size={15} /> {t.busy === 'test' ? 'Testing…' : 'Test'}
          </button>
        )}
        {t.cfg?.configured && (
          <button className="btn btn-ghost" onClick={t.doRemove} disabled={!!t.busy} style={{ color: 'var(--color-error)' }}>
            <Trash2 size={15} /> Remove my key
          </button>
        )}
      </div>
    </>
  );
}

const PROVIDER = { serpapi: 'SerpAPI', brave: 'Brave', ddg: 'DuckDuckGo', scholar_direct: 'Scholar (direct)' };
const FEATURE = { find_kols: 'Find KOLs', scholar: 'Google Scholar' };
const th = { textAlign: 'left', padding: '6px 8px', fontSize: '0.76rem', color: 'var(--color-text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' };
const td = { padding: '6px 8px', fontSize: '0.8rem', borderBottom: '1px solid var(--color-border-light)' };

// This account's own searches (and its own SerpAPI key's plan, if it has one).
function MyUsage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await getMyWebSearchUsage(30)).data); } catch { /* optional panel */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const tiles = [
    ['SerpAPI searches', data.totals.serpapi],
    ['Free fallback used', data.totals.fallback],
    ['Failed calls', data.totals.failed],
  ];
  return (
    <div style={{ marginTop: 26, borderTop: '1px solid var(--color-border-light)', paddingTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: '0.92rem' }}>My usage — last 30 days</strong>
        <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading} title="Refresh" style={{ marginLeft: 'auto' }}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
        </button>
      </div>
      {data.accounts.map((a) => {
        const quota = (a.searches_per_month || 0) + (a.extra_credits || 0);
        const used = a.this_month_usage || 0;
        return (
          <div key={a.key} className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
            {a.error ? (
              <span style={{ color: 'var(--color-error)', fontSize: '0.85rem' }}><AlertTriangle size={13} /> Your key ({a.key}): {a.error}</span>
            ) : (
              <>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  Your SerpAPI plan — <strong style={{ color: 'var(--color-text)' }}>{a.plan_name}</strong> · {a.account_email} · renews {a.plan_renewal_date}
                </div>
                <div style={{ marginTop: 6 }}><strong style={{ fontSize: '1.25rem' }}>{used}</strong> of {quota} searches used this month · <strong>{a.total_searches_left}</strong> left</div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg)', marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${quota ? Math.min(100, (used / quota) * 100) : 0}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 4 }} />
                </div>
              </>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {tiles.map(([label, v]) => (
          <div key={label} className="card" style={{ padding: '10px 14px', flex: '1 1 140px' }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>{label}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      {data.recent.length > 0 && (
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>When</th><th style={th}>Feature</th><th style={th}>Provider</th><th style={th}>Result</th></tr></thead>
            <tbody>
              {data.recent.map((r, i) => (
                <tr key={i} title={r.query || ''}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.at ? new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td style={td}>{FEATURE[r.feature] || r.feature}</td>
                  <td style={td}>{PROVIDER[r.provider] || r.provider}{r.key_scope === 'account' ? ' (my key)' : r.key_scope === 'platform' ? ' (platform key)' : ''}</td>
                  <td style={td}>{r.status === 'ok' ? `${r.results} results`
                    : <span style={{ color: 'var(--color-error)' }} title={r.error || ''}><XCircle size={12} style={{ verticalAlign: -2 }} /> {r.status === 'quota' ? 'Quota / key' : 'Error'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function GoogleSearchTab({ onNotice }) {
  const t = useKeyTab({
    load: getMyWebSearchConfig, save: saveMyWebSearchConfig, remove: deleteMyWebSearchConfig,
    test: testMyWebSearchConfig, onNotice, label: 'Google Search',
  });
  return (
    <div className="account-card">
      <div className="account-card-header">
        <h3><Globe size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Google Search (SerpAPI)</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          Used by <strong>Find KOLs → Google search</strong>. Your key is tried first, then the platform key,
          then free Brave / DuckDuckGo results.
        </p>
      </div>
      <div className="account-card-body">
        {t.cfg && <SourceBanner source={t.cfg.source} what="Google search in Find KOLs" />}
        <KeyForm t={t} />
        <MyUsage />
      </div>
    </div>
  );
}

export function GoogleScholarTab({ onNotice }) {
  const t = useKeyTab({
    load: getMyScholarConfig, save: saveMyScholarConfig, remove: deleteMyScholarConfig,
    test: testMyScholarConfig, onNotice, label: 'Google Scholar',
  });
  return (
    <div className="account-card">
      <div className="account-card-header">
        <h3><BookOpen size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Google Scholar</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          Used to detect guideline / consensus authorship in assessments and KOL details. With a SerpAPI key
          it uses SerpAPI's Google Scholar engine; otherwise (or if the key fails) it reads Google Scholar directly.
        </p>
      </div>
      <div className="account-card-body">
        {t.cfg && <SourceBanner source={t.cfg.source} what="Google Scholar" />}
        <KeyForm t={t} showProvider />
      </div>
    </div>
  );
}
