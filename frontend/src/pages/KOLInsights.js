import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { BookOpen, Phone, Hourglass, FileSearch, Loader, Info, Trophy } from 'lucide-react';
import { getKOLInsights, enrichKOLsBulk } from '../services/api';

// The public-data part of the assessment score — see backend services/kol_ranking.py.
const PARTS = [
  ['publications', 'Publications (5 yrs)', 'C.3 — 1+ paper: 2, 5+: 3, 10+: 4', 4],
  ['velocity', 'Publication velocity', 'C.5 — 2+/yr: 1, 5+/yr: 2, 10+/yr: 3', 3],
  ['experience', 'Experience', 'C.4 — 1+ yrs: 1, 5+: 2, 10+: 3, 15+: 4', 4],
  ['trials', 'Trials led', 'C.7 — ClinicalTrials.gov lead + CTRI PI. 1+: 1, 3+: 2, 5+: 3', 3],
  ['guidelines', 'Guideline authorship', 'C.8 — national: 2, international: 3', 3],
];

const axisTick = { fill: 'var(--color-text-secondary)', fontSize: 12 };
const short = (s, n = 26) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ChartCard({ title, subtitle, children, action }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</div>
          {subtitle && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function TipBox({ children }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8,
      padding: '8px 10px', fontSize: '0.78rem', color: 'var(--color-text)', boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
      maxWidth: 280,
    }}>
      {children}
    </div>
  );
}

function TopTip({ active, payload, max }) {
  if (!active || !payload?.length) return null;
  const k = payload[0].payload;
  return (
    <TipBox>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{k.name}</div>
      <div style={{ color: 'var(--color-text-secondary)', marginBottom: 6 }}>
        {[k.specialty, k.institution, k.place].filter(Boolean).join(' · ') || '—'}
      </div>
      {PARTS.map(([key, label, , cap]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
          <span style={{ fontWeight: 600 }}>{k.parts[key]} / {cap}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>Score</span><strong>{k.score} / {max}</strong>
      </div>
      <div style={{ color: 'var(--color-text-light)', marginTop: 4 }}>
        {k.publications} papers · {k.trials_led} trials led · {k.experience_years ?? '—'} yrs — click to open
      </div>
    </TipBox>
  );
}

function CountTip({ active, payload, unit = 'KOLs' }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return <TipBox><strong>{d.label}</strong> — {d.count} {unit}</TipBox>;
}

// One-series horizontal bar of counts — one hue, value labelled at the bar end.
function CountBars({ data, color = 'var(--color-accent)' }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke="var(--color-border-light)" />
        <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={axisTick} tickFormatter={(v) => short(v, 22)}
          axisLine={false} tickLine={false} />
        <Tooltip content={<CountTip />} cursor={{ fill: 'var(--color-surface-hover)' }} />
        <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
          <LabelList dataKey="count" position="right" style={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function KOLInsights({ filters, onOpen, onNotice }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await getKOLInsights(JSON.parse(filterKey));
      setData(res.data);
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Could not load the charts.');
    } finally {
      setLoading(false);
    }
  }, [filterKey, onNotice]);

  useEffect(() => { load(); }, [load]);

  // Research data is fetched in the background — refresh while any is running.
  useEffect(() => {
    if (!data?.running) return undefined;
    const t = setInterval(() => load(true), 8000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  const fetchResearch = async () => {
    const ids = data.not_enriched_ids;
    if (!window.confirm(`Fetch publications, clinical trials and guideline authorship for ${ids.length} KOL${ids.length === 1 ? '' : 's'}?\n\n`
      + 'Runs in the background (a few seconds per KOL). Google Scholar uses your SerpAPI key where one is set.')) return;
    setBusy(true);
    try {
      const r = await enrichKOLsBulk(ids);
      onNotice?.(`Fetching research data for ${r.data.queued} KOL${r.data.queued === 1 ? '' : 's'} — the ranking updates as they finish.`, 'success');
      await load(true);
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Could not start.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="loading-container"><div className="spinner"></div><p>Building charts...</p></div>;
  }
  if (!data || data.total === 0) {
    return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>No KOLs match these filters.</div>;
  }

  const missing = data.total - data.enriched;
  const top = data.top.map((k, i) => ({ ...k, label: `${i + 1}. ${k.name}` }));
  const breakdowns = [
    ['Therapeutic area', data.by_therapeutic_area],
    ['Specialty', data.by_specialty],
    ['City / State', data.by_place],
  ].filter(([, rows]) => rows.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Coverage: the ranking is only as good as the research data behind it. */}
      {missing > 0 && (
        <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'var(--color-warning-bg)', borderColor: 'var(--color-warning)' }}>
          <Info size={18} style={{ color: 'var(--color-warning-text)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 240, fontSize: '0.84rem', color: 'var(--color-warning-text)' }}>
            <strong>Research data for {data.enriched} of {data.total} KOLs.</strong> The other {missing} can only
            score on experience, so they may rank lower than they should.
            {data.running > 0 && <> Fetching for {data.running} now…</>}
          </div>
          {data.not_enriched_ids.length > 0 && (
            <button className="btn btn-sm btn-primary" onClick={fetchResearch} disabled={busy}>
              {busy ? <Loader size={14} className="spinning" /> : <FileSearch size={14} />}
              {' '}Fetch research data ({data.not_enriched_ids.length})
            </button>
          )}
        </div>
      )}

      {/* The Directory's own row above already shows the total. */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon info"><BookOpen size={20} /></div>
          <div className="stat-label">With research data</div>
          <div className="stat-value">{data.enriched}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success"><Phone size={20} /></div>
          <div className="stat-label">With email / phone</div>
          <div className="stat-value">{data.with_contact}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon warning"><Hourglass size={20} /></div>
          <div className="stat-label">Avg experience</div>
          <div className="stat-value">{data.avg_experience != null ? `${data.avg_experience} yrs` : '—'}</div>
        </div>
      </div>

      <ChartCard
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trophy size={16} style={{ color: 'var(--color-primary)' }} /> Top KOLs</span>}
        subtitle={`Ranked by the assessment criteria public data can fill — score out of ${data.max_score}. Hover for the breakdown, click to open.`}
        action={(
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowHow((v) => !v)}>How is this scored?</button>
            <button className="btn btn-sm btn-outline" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Chart' : 'Table'}</button>
          </div>
        )}>
        {showHow && (
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', background: 'var(--color-bg)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            Uses the same scoring as an Assessment (C.1–C.9), for the criteria that public data can fill:
            <ul style={{ margin: '6px 0 6px 18px', padding: 0 }}>
              {PARTS.map(([key, label, rule, cap]) => <li key={key}><strong>{label}</strong> (max {cap}) — {rule}</li>)}
            </ul>
            Leadership, presentations and editorial roles need an Assessment, so the formal KOL tier comes from there.
            Ties are broken by number of papers, then trials, then experience.
          </div>
        )}
        {top.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '0.86rem' }}>
            No KOL scores above 0 yet — fetch research data or add experience to rank them.
          </div>
        ) : asTable ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
              <thead>
                <tr>
                  <th>#</th><th>KOL</th><th style={{ textAlign: 'right' }}>Score</th>
                  <th style={{ textAlign: 'right' }}>Papers (5 yrs)</th><th style={{ textAlign: 'right' }}>Pubs / yr</th>
                  <th style={{ textAlign: 'right' }}>Trials led</th><th style={{ textAlign: 'right' }}>Experience</th>
                </tr>
              </thead>
              <tbody>
                {top.map((k, i) => (
                  <tr key={k.id} onClick={() => onOpen(k.id)} style={{ cursor: 'pointer' }}>
                    <td>{i + 1}</td>
                    <td><strong>{k.name}</strong><div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{[k.specialty, k.institution].filter(Boolean).join(' · ')}</div></td>
                    <td style={{ textAlign: 'right' }}><strong>{k.score}</strong> / {data.max_score}</td>
                    <td style={{ textAlign: 'right' }}>{k.publications}</td>
                    <td style={{ textAlign: 'right' }}>{k.pubs_per_year}</td>
                    <td style={{ textAlign: 'right' }}>{k.trials_led}</td>
                    <td style={{ textAlign: 'right' }}>{k.experience_years != null ? `${k.experience_years} yrs` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={top.length * 36 + 30}>
            <BarChart data={top} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke="var(--color-border-light)" />
              <XAxis type="number" domain={[0, data.max_score]} ticks={[0, 5, 10, 15]} tick={axisTick}
                axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={210} tick={axisTick} tickFormatter={(v) => short(v, 28)}
                axisLine={false} tickLine={false} />
              <Tooltip content={<TopTip max={data.max_score} />} cursor={{ fill: 'var(--color-surface-hover)' }} />
              <Bar dataKey="score" fill="var(--color-primary)" radius={[0, 4, 4, 0]} maxBarSize={22}
                isAnimationActive={false} cursor="pointer" onClick={(d) => onOpen(d.id)}>
                <LabelList dataKey="score" position="right"
                  formatter={(v) => `${v} / ${data.max_score}`}
                  style={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 14 }}>
        <ChartCard title="Score distribution" subtitle={`How many KOLs fall in each score range (out of ${data.max_score})`}>
          <CountBars data={data.score_bands} color="var(--color-primary)" />
        </ChartCard>
        {breakdowns.map(([title, rows]) => (
          <ChartCard key={title} title={`KOLs by ${title.toLowerCase()}`}>
            <CountBars data={rows} />
          </ChartCard>
        ))}
      </div>
    </div>
  );
}
