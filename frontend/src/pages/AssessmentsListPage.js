import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ClipboardCheck, Plus, Eye, Search, Award, Users, TrendingUp,
  LinkIcon, Trash2, ToggleLeft, ToggleRight, CheckCircle,
  Loader, ExternalLink, FileText, Brain, AlertCircle, XCircle,
  User, Building2, Star, ArrowRight, Calendar, Link2, X, Download, UserSearch,
  MapPin, Clock,
} from 'lucide-react';
import Pagination from '../components/Pagination';
import FindKOLsTab from './FindKOLsTab';
import {
  listHCPs, listAssessments, createFormLink, listFormLinks,
  deleteFormLink, toggleFormLink, listFormSubmissions, deleteFormSubmission,
  startAssessmentFromSubmission, scoreWithAI, markSubmissionAssessed, getMe,
  downloadSubmissionCV,
} from '../services/api';

// Assessed more than six months ago. Declared at module scope so the filter
// predicate can use it before the insight block below is evaluated.
const STALE_MS = 180 * 24 * 60 * 60 * 1000;
function isStale(row) {
  const at = row.assessment?.created_at;
  if (!at) return false;
  return Date.now() - new Date(at).getTime() > STALE_MS;
}

function getTierBadge(tier) {
  if (!tier) return <span className="badge badge-non-kol">Not Assessed</span>;
  const cls = tier.toLowerCase().replace(/[\s-]/g, '_');
  const classMap = {
    global_kol: 'badge-global', strategic_kol: 'badge-strategic', national_kol: 'badge-national',
    emerging_kol: 'badge-emerging', local_kol: 'badge-local', non_kol: 'badge-non-kol',
  };
  return <span className={`badge ${classMap[cls] || 'badge-non-kol'}`}>{tier.replace(/_/g, ' ')}</span>;
}

function getStatusBadge(status) {
  const map = {
    pending: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', label: 'Pending' },
    processing: { bg: 'var(--color-info-bg)', color: 'var(--color-info-text)', label: 'Processing' },
    assessed: { bg: 'var(--color-success-bg)', color: 'var(--color-success-text)', label: 'Assessed' },
    failed: { bg: 'var(--color-error-bg)', color: 'var(--color-error-text)', label: 'Failed' },
  };
  const s = map[status] || { bg: 'var(--color-surface-raised)', color: 'var(--color-text-secondary)', label: status };
  return (
    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: '0.73rem', fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ─── Assessments Tab ─────────────────────────────────────
function AssessmentsTab() {
  const navigate = useNavigate();
  const [hcps, setHcps] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tierFilter, setTierFilter] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  // Data-quality / follow-up filters, kept separate from the tier facet so the
  // two can be combined ("Global KOLs with no CV").
  const [flagFilter, setFlagFilter] = useState('');
  const [showInsights, setShowInsights] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [hcpRes, assessRes] = await Promise.all([listHCPs({ limit: 500 }), listAssessments({ limit: 500 })]);
        setHcps(hcpRes.data.items || hcpRes.data || []);
        setAssessments(assessRes.data.items || assessRes.data || []);
      } catch (err) { console.error('Failed to load data', err); }
      finally { setLoading(false); }
    }
    fetchData();
  }, []);

  const assessmentMap = {};
  assessments.forEach(a => {
    if (!assessmentMap[a.hcp_id] || new Date(a.created_at) > new Date(assessmentMap[a.hcp_id].created_at))
      assessmentMap[a.hcp_id] = a;
  });

  const rows = hcps.map(hcp => ({ ...hcp, assessment: assessmentMap[hcp.id] || null }));

  // Tier values come back upper-snake ('GLOBAL_KOL'); normalise once so every
  // comparison below is case-insensitive.
  const tierKey = (t) => (t || '').toString().toLowerCase().replace(/[\s-]/g, '_');

  // Facet options built from the data actually present, so the dropdowns never
  // offer a filter that would return nothing.
  const tierOptions = [...new Set(rows.map(r => tierKey(r.assessment?.tier)).filter(Boolean))].sort();
  const specialtyOptions = [...new Set(rows.map(r => r.specialty).filter(Boolean))].sort();

  const q = search.trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (q && !(
      r.full_name?.toLowerCase().includes(q) ||
      r.specialty?.toLowerCase().includes(q) ||
      r.institution?.toLowerCase().includes(q)
    )) return false;
    if (tierFilter) {
      // 'unassessed' is its own filter — an HCP with no assessment at all.
      if (tierFilter === 'unassessed') { if (r.assessment) return false; }
      else if (tierKey(r.assessment?.tier) !== tierFilter) return false;
    }
    if (specialtyFilter && r.specialty !== specialtyFilter) return false;
    if (flagFilter === 'no_cv' && r.cv_file_path) return false;
    if (flagFilter === 'no_contact' && (r.email || r.mobile)) return false;
    if (flagFilter === 'stale' && !isStale(r)) return false;
    return true;
  });

  const scoreOf = (r) => (r.assessment?.final_score ?? -1);
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'score_desc': return scoreOf(b) - scoreOf(a);
      case 'score_asc': return scoreOf(a) - scoreOf(b);
      case 'name': return (a.full_name || '').localeCompare(b.full_name || '');
      case 'oldest':
        return new Date(a.assessment?.created_at || a.created_at || 0)
             - new Date(b.assessment?.created_at || b.created_at || 0);
      default: // recent
        return new Date(b.assessment?.created_at || b.created_at || 0)
             - new Date(a.assessment?.created_at || a.created_at || 0);
    }
  });

  const paginatedRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  // Any change to the query resets paging — otherwise a filter that shrinks the
  // result set leaves you stranded on a page that no longer exists.
  useEffect(() => { setPage(1); }, [search, tierFilter, specialtyFilter, sortBy, flagFilter]);

  const filtersActive = Boolean(q || tierFilter || specialtyFilter || flagFilter);
  const clearFilters = () => { setSearch(''); setTierFilter(''); setSpecialtyFilter(''); setFlagFilter(''); };

  const totalHCPs = hcps.length;
  const assessed = Object.keys(assessmentMap).length;
  const pending = totalHCPs - assessed;
  // ⚠️ Was comparing against lowercase 'global_kol' while the API returns
  // 'GLOBAL_KOL', so this tile read 0 no matter how many top-tier KOLs existed.
  const topTier = Object.values(assessmentMap)
    .filter(a => ['global_kol', 'strategic_kol'].includes(tierKey(a.tier))).length;

  const scored = Object.values(assessmentMap).filter(a => a.final_score != null);
  const avgScore = scored.length
    ? (scored.reduce((n, a) => n + a.final_score, 0) / scored.length).toFixed(1)
    : '--';

  // Tier mix across the assessed book, ordered high → low.
  const TIER_LADDER = ['global_kol', 'strategic_kol', 'national_kol', 'emerging_kol', 'local_kol', 'non_kol'];
  const mixCounts = Object.values(assessmentMap).reduce((acc, a) => {
    const k = tierKey(a.tier);
    if (k) acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const mixRows = [
    ...TIER_LADDER.filter(t => mixCounts[t]).map(t => ({ key: t, count: mixCounts[t] })),
    // A tier the ladder does not know about still shows rather than vanishing.
    ...Object.keys(mixCounts).filter(t => !TIER_LADDER.includes(t)).map(t => ({ key: t, count: mixCounts[t] })),
  ];
  const mixTotal = mixRows.reduce((n, r) => n + r.count, 0);

  // ── Insights ──
  // "Stale" = assessed more than six months ago. A KOL's standing moves with
  // publications and appointments, so an old score is a stale score, not a
  // finished one.
  const STALE_DAYS = 180;

  const maxScore = Math.max(50, ...scored.map(a => a.final_score));
  // Buckets sized off the observed ceiling rather than a hardcoded 100 — the
  // rubric tops out around 50, so fixed 0-100 buckets would leave half empty.
  const BUCKETS = 5;
  const bucketSize = Math.ceil(maxScore / BUCKETS);
  const distribution = Array.from({ length: BUCKETS }, (_, i) => {
    const lo = i * bucketSize;
    const hi = lo + bucketSize;
    return {
      label: `${lo}-${hi}`,
      count: scored.filter(a => a.final_score >= lo && (i === BUCKETS - 1 ? a.final_score <= hi : a.final_score < hi)).length,
    };
  });
  const distMax = Math.max(1, ...distribution.map(d => d.count));

  const specialtyCounts = rows.reduce((acc, r) => {
    if (r.specialty) acc[r.specialty] = (acc[r.specialty] || 0) + 1;
    return acc;
  }, {});
  const topSpecialties = Object.entries(specialtyCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([specialty, count]) => ({ specialty, count }));
  const specMax = Math.max(1, ...topSpecialties.map(t => t.count));

  const leaderboard = rows
    .filter(r => r.assessment?.final_score != null)
    .sort((a, b) => b.assessment.final_score - a.assessment.final_score)
    .slice(0, 5);
  const leaderMax = Math.max(1, ...leaderboard.map(r => r.assessment.final_score));

  // Data completeness — what is missing is what stops a score being trustworthy.
  const withCv = rows.filter(r => r.cv_file_path).length;
  const withContact = rows.filter(r => r.email || r.mobile).length;
  const withInstitution = rows.filter(r => r.institution).length;
  const completeness = [
    { key: 'cv', label: 'CV on file', have: withCv },
    { key: 'contact', label: 'Email or mobile', have: withContact },
    { key: 'institution', label: 'Institution set', have: withInstitution },
  ];

  const staleCount = rows.filter(isStale).length;
  const noCvCount = rows.length - withCv;
  const noContactCount = rows.length - withContact;

  const flagChips = [
    { key: 'unassessed', label: 'Not assessed', count: pending, apply: () => { setFlagFilter(''); setTierFilter(tierFilter === 'unassessed' ? '' : 'unassessed'); }, active: tierFilter === 'unassessed' },
    { key: 'stale', label: `Assessed over ${STALE_DAYS / 30 | 0} months ago`, count: staleCount },
    { key: 'no_cv', label: 'No CV uploaded', count: noCvCount },
    { key: 'no_contact', label: 'No contact details', count: noContactCount },
  ].filter(c => c.count > 0);

  const exportCsv = () => {
    const head = ['Name', 'Specialty', 'Institution', 'Score', 'Tier', 'Assessed On'];
    // Quotes doubled and every field wrapped — names and institutions contain
    // commas often enough that anything less corrupts the file.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = sorted.map(r => [
      r.full_name, r.specialty, r.institution,
      r.assessment?.final_score ?? '', (r.assessment?.tier || '').replace(/_/g, ' '),
      r.assessment?.created_at ? new Date(r.assessment.created_at).toLocaleDateString() : '',
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kol-assessments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="loading-container"><div className="spinner"></div><p>Loading assessments...</p></div>;

  return (
    <>
      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 24 }}>
        <div className="stat-card"><div className="stat-icon primary"><Users size={20} /></div><div className="stat-label">Total HCPs</div><div className="stat-value">{totalHCPs}</div></div>
        <div className="stat-card"><div className="stat-icon success"><ClipboardCheck size={20} /></div><div className="stat-label">Assessed</div><div className="stat-value">{assessed}</div></div>
        <div className="stat-card"><div className="stat-icon warning"><TrendingUp size={20} /></div><div className="stat-label">Pending</div><div className="stat-value">{pending}</div></div>
        <div className="stat-card"><div className="stat-icon info"><Award size={20} /></div><div className="stat-label">Top Tier</div><div className="stat-value">{topTier}</div><div className="stat-sub">global &amp; strategic</div></div>
        <div className="stat-card"><div className="stat-icon primary"><Star size={20} /></div><div className="stat-label">Avg Score</div><div className="stat-value">{avgScore}</div><div className="stat-sub">across {scored.length} assessed</div></div>
      </div>

      {/* Tier mix — one glance at the shape of the book, which four counters
          cannot give you. */}
      {mixTotal > 0 && (
        <div className="card tier-mix">
          <div className="tier-mix-head">
            <span className="tier-mix-title">Tier Mix</span>
            <span className="tier-mix-total">{mixTotal} assessed</span>
          </div>
          <div className="tier-mix-bar">
            {mixRows.map(r => (
              <span
                key={r.key}
                className={`tier-mix-seg tier-${r.key}`}
                style={{ width: `${(r.count / mixTotal) * 100}%` }}
                title={`${r.key.replace(/_/g, ' ')}: ${r.count}`}
              />
            ))}
          </div>
          <div className="tier-mix-legend">
            {mixRows.map(r => (
              <button
                type="button"
                key={r.key}
                className={`tier-mix-key${tierFilter === r.key ? ' is-active' : ''}`}
                onClick={() => setTierFilter(tierFilter === r.key ? '' : r.key)}
                title={`Filter by ${r.key.replace(/_/g, ' ')}`}
              >
                <span className={`tier-dot tier-${r.key}`} />
                {r.key.replace(/_/g, ' ')}
                <strong>{r.count}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Insights — the page was four counters and a list; this is the shape of
          the book, who leads it, and what is missing from it. */}
      {rows.length > 0 && (
        <>
          <button type="button" className="insights-toggle" onClick={() => setShowInsights(v => !v)}>
            {showInsights ? 'Hide' : 'Show'} insights
          </button>

          {showInsights && (
            <div className="insights-grid">
              {/* Leaderboard */}
              {leaderboard.length > 0 && (
                <div className="card insight-card">
                  <div className="insight-head"><Award size={15} /> Top Scoring KOLs</div>
                  <div className="leader-list">
                    {leaderboard.map((r, i) => (
                      <Link key={r.id} to={`/hcp/${r.id}/results`} className="leader-row">
                        <span className={`leader-rank rank-${i + 1}`}>{i + 1}</span>
                        <span className="leader-main">
                          <span className="leader-name">{r.full_name}</span>
                          <span className="leader-bar">
                            <span
                              className={`leader-fill tier-${(r.assessment.tier || '').toLowerCase()}`}
                              style={{ width: `${(r.assessment.final_score / leaderMax) * 100}%` }}
                            />
                          </span>
                        </span>
                        <span className="leader-score">{r.assessment.final_score.toFixed(1)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Score distribution */}
              {scored.length > 0 && (
                <div className="card insight-card">
                  <div className="insight-head"><TrendingUp size={15} /> Score Distribution</div>
                  <div className="dist-chart">
                    {distribution.map(d => (
                      <div className="dist-col" key={d.label} title={`${d.label}: ${d.count}`}>
                        <span className="dist-count">{d.count}</span>
                        <span className="dist-track">
                          <span className="dist-bar" style={{ height: `${(d.count / distMax) * 100}%` }} />
                        </span>
                        <span className="dist-label">{d.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Specialty coverage */}
              {topSpecialties.length > 0 && (
                <div className="card insight-card">
                  <div className="insight-head"><Star size={15} /> Specialty Coverage</div>
                  <div className="rank-list">
                    {topSpecialties.map(t => (
                      <button
                        type="button"
                        key={t.specialty}
                        className={`rank-row rank-row-btn${specialtyFilter === t.specialty ? ' is-active' : ''}`}
                        onClick={() => setSpecialtyFilter(specialtyFilter === t.specialty ? '' : t.specialty)}
                      >
                        <span className="rank-label" title={t.specialty}>{t.specialty}</span>
                        <span className="rank-track">
                          <span className="rank-fill" style={{ width: `${(t.count / specMax) * 100}%` }} />
                        </span>
                        <span className="rank-count">{t.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Data completeness */}
              <div className="card insight-card">
                <div className="insight-head"><ClipboardCheck size={15} /> Profile Completeness</div>
                <div className="rank-list">
                  {completeness.map(c => (
                    <div className="rank-row" key={c.key}>
                      <span className="rank-label" title={c.label}>{c.label}</span>
                      <span className="rank-track">
                        <span className="rank-fill" style={{ width: `${(c.have / rows.length) * 100}%` }} />
                      </span>
                      <span className="rank-count">{Math.round((c.have / rows.length) * 100)}%</span>
                    </div>
                  ))}
                </div>
                <p className="insight-note">
                  {withCv}/{rows.length} profiles are document-backed. A score built
                  without a CV rests on hand-entered detail alone.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Follow-up chips — each is a filter, so a gap becomes a worklist. */}
      {flagChips.length > 0 && (
        <div className="flag-chips">
          <span className="flag-chips-label">Needs attention</span>
          {flagChips.map(c => {
            const active = c.active !== undefined ? c.active : flagFilter === c.key;
            return (
              <button
                type="button"
                key={c.key}
                className={`flag-chip${active ? ' is-active' : ''}`}
                onClick={c.apply ? c.apply : () => { setTierFilter(''); setFlagFilter(flagFilter === c.key ? '' : c.key); }}
              >
                {c.label}<strong>{c.count}</strong>
              </button>
            );
          })}
        </div>
      )}

      {/* Filter toolbar */}
      <div className="filter-bar">
        <div className="filter-search">
          <Search size={16} />
          <input className="form-control"
            placeholder="Search by name, specialty, or institution..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <select className="form-control filter-select" value={tierFilter} onChange={e => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          {tierOptions.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          <option value="unassessed">Not assessed</option>
        </select>

        <select className="form-control filter-select" value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value)}>
          <option value="">All specialties</option>
          {specialtyOptions.map(sp => <option key={sp} value={sp}>{sp}</option>)}
        </select>

        <select className="form-control filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="recent">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score_desc">Score: high to low</option>
          <option value="score_asc">Score: low to high</option>
          <option value="name">Name A–Z</option>
        </select>

        <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={sorted.length === 0}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="filter-summary">
        <span>
          Showing <strong>{sorted.length}</strong> of <strong>{rows.length}</strong> HCP{rows.length === 1 ? '' : 's'}
        </span>
        {filtersActive && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <X size={14} /> Clear filters
          </button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          {hcps.length === 0 ? (
            <>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <ClipboardCheck size={28} style={{ color: 'var(--color-primary)' }} />
              </div>
              <h3 style={{ marginBottom: 6 }}>No Assessments Yet</h3>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>Create your first HCP profile to start assessing.</p>
              <button className="btn btn-primary" onClick={() => navigate('/hcp/new')}><Plus size={16} /> New Assessment</button>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                No HCPs match {q ? <>“{search}”</> : 'these filters'}.
              </p>
              <button className="btn btn-secondary" onClick={clearFilters}><X size={14} /> Clear filters</button>
            </>
          )}
        </div>
      ) : (
        /* HCP Cards List */
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {paginatedRows.map(row => {
            const a = row.assessment;
            const hasScore = a && a.final_score != null;
            return (
              <div key={row.id} className="card" style={{ overflow: 'hidden', transition: 'all var(--transition)' }}>
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  {/* Score indicator bar */}
                  <div style={{
                    width: 6, flexShrink: 0,
                    background: hasScore
                      ? a.final_score >= 45 ? 'var(--brand-blue)'
                      : a.final_score >= 35 ? 'var(--brand-teal)'
                      : a.final_score >= 25 ? 'var(--brand-green-4)'
                      : a.final_score >= 15 ? 'var(--brand-green-3)'
                      : a.final_score >= 5 ? 'var(--brand-green-1)'
                      : 'var(--color-text-light)'
                      : 'var(--color-surface-raised)',
                  }} />

                  {/* Content */}
                  <div style={{ flex: 1, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    {/* Avatar/Score circle */}
                    <div style={{
                      width: 52, height: 52, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: hasScore ? 'var(--color-primary-bg)' : 'var(--color-bg)',
                      border: hasScore ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
                    }}>
                      {hasScore ? (
                        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                          {a.final_score.toFixed(0)}
                        </span>
                      ) : (
                        <User size={20} style={{ color: 'var(--color-text-light)' }} />
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Row 1: Name + Tier */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text)', cursor: 'pointer' }}
                          onClick={() => navigate(`/hcp/${row.id}`)}>
                          {row.full_name}
                        </span>
                        {getTierBadge(a?.tier)}
                      </div>
                      {/* Row 2: Details */}
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {row.specialty && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                            <Star size={12} style={{ color: 'var(--color-primary-light)' }} /> {row.specialty}
                          </span>
                        )}
                        {row.institution && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                            <Building2 size={12} style={{ color: 'var(--color-text-light)' }} /> {row.institution}
                          </span>
                        )}
                        {row.city && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
                            <MapPin size={11} /> {row.city}
                          </span>
                        )}
                        {row.years_of_experience != null && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
                            <Clock size={11} /> {row.years_of_experience} yr{row.years_of_experience === 1 ? '' : 's'}
                          </span>
                        )}
                        {a?.created_at && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: isStale(row) ? 'var(--color-warning-text)' : 'var(--color-text-light)' }}
                                title={isStale(row) ? 'Assessed over 6 months ago' : undefined}>
                            <Calendar size={11} /> {new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {isStale(row) && ' · stale'}
                          </span>
                        )}
                      </div>

                      {/* What backs this profile. A score assembled from a CV is
                          a different thing from one typed in by hand. */}
                      <div className="card-flags">
                        <span className={`card-flag${row.cv_file_path ? ' is-on' : ''}`} title={row.cv_file_path ? 'CV on file' : 'No CV uploaded'}>
                          <FileText size={11} /> CV
                        </span>
                        <span className={`card-flag${(row.email || row.mobile) ? ' is-on' : ''}`} title={(row.email || row.mobile) ? (row.email || row.mobile) : 'No contact details'}>
                          <User size={11} /> Contact
                        </span>
                        {row.publications && (
                          <span className="card-flag is-on" title="Publications recorded"><Star size={11} /> Publications</span>
                        )}
                        {row.office_bearer_positions && (
                          <span className="card-flag is-on" title="Office-bearer positions recorded"><Award size={11} /> Office bearer</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {a ? (
                        <Link to={`/hcp/${row.id}/results`} className="btn btn-sm btn-outline">
                          <Eye size={13} /> View Results
                        </Link>
                      ) : (
                        <Link to={`/hcp/${row.id}/assess`} className="btn btn-sm btn-primary">
                          <ClipboardCheck size={13} /> Assess
                        </Link>
                      )}
                      <Link to={`/hcp/${row.id}`} className="btn btn-sm btn-ghost" title="View profile">
                        <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={pageSize}
          onPageChange={setPage} onPageSizeChange={n => { setPageSize(n); setPage(1); }} />
        </>
      )}
    </>
  );
}

// ─── Form Links Tab ──────────────────────────────────────
function FormLinksTab({ onCountChange }) {
  const navigate = useNavigate();
  const [links, setLinks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState('');
  const [viewSub, setViewSub] = useState(null);
  const [subFilter, setSubFilter] = useState('all');   // all | pending | assessed
  const [subQuery, setSubQuery] = useState('');
  const [subSort, setSubSort] = useState('newest');

  const fetchData = useCallback(async () => {
    try {
      const [linksRes, subsRes] = await Promise.all([listFormLinks(), listFormSubmissions()]);
      setLinks(linksRes.data || []); setSubmissions(subsRes.data || []);
      if (onCountChange) onCountChange();
    } catch (err) { console.error('Failed to load form links data', err); }
    finally { setLoading(false); }
  }, [onCountChange]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try { await createFormLink({ title: newTitle.trim() || 'HCP Assessment Form' }); setShowCreate(false); setNewTitle(''); await fetchData(); }
    catch { setError('Failed to create form link'); }
    finally { setCreating(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this form link? All submissions will also be deleted.')) return;
    try { await deleteFormLink(id); await fetchData(); } catch { setError('Failed to delete'); }
  };

  const handleToggle = async (id) => {
    try { await toggleFormLink(id); await fetchData(); } catch { setError('Failed to toggle'); }
  };

  const copyLink = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/form/${token}`);
    setCopiedId(token); setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadCV = async (subId, name) => {
    try {
      const res = await downloadSubmissionCV(subId);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = `cv_${name || subId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Failed to download CV'); }
  };

  const handleDeleteSubmission = async (subId) => {
    if (!window.confirm('Delete this submission?')) return;
    try { await deleteFormSubmission(subId); await fetchData(); } catch { setError('Failed to delete submission'); }
  };

  const handleStartAssessment = async (subId) => {
    setProcessingId(subId); setError('');
    try {
      const res = await startAssessmentFromSubmission(subId);
      const hcpId = res.data.hcp_id;
      if (res.data.status === 'already_assessed') { navigate(`/hcp/${hcpId}/results`); return; }
      try {
        await scoreWithAI(hcpId);
        await markSubmissionAssessed(subId);
        navigate(`/hcp/${hcpId}/results`);
      } catch (scoreErr) {
        const msg = scoreErr.code === 'ECONNABORTED'
          ? 'AI analysis timed out. HCP profile created — retry from Assessments tab.'
          : (scoreErr.response?.data?.detail || 'AI scoring failed. HCP profile created — retry from Assessments tab.');
        setError(msg); setProcessingId(null);
        try { await markSubmissionAssessed(subId); } catch {}
        await fetchData();
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Assessment failed. Please try again.');
      setProcessingId(null); await fetchData();
    }
  };

  if (loading) return <div className="loading-container"><div className="spinner"></div><p>Loading form links...</p></div>;

  const pendingSubs = submissions.filter(s => s.status === 'pending' || s.status === 'failed');
  const assessedSubs = submissions.filter(s => s.status === 'assessed');

  const visibleSubs = submissions.filter(sub => {
    if (subFilter === 'pending' && !(sub.status === 'pending' || sub.status === 'failed')) return false;
    if (subFilter === 'assessed' && sub.status !== 'assessed') return false;
    if (!subQuery.trim()) return true;
    const q = subQuery.trim().toLowerCase();
    return [sub.full_name, sub.specialty, sub.institution, sub.form_link_title]
      .some(v => (v || '').toLowerCase().includes(q));
  });
  const sortedSubs = [...visibleSubs].sort((a, b) => {
    switch (subSort) {
      case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
      case 'name':   return (a.full_name || '').localeCompare(b.full_name || '');
      // Pending first, then newest — the queue order you actually work in.
      case 'status': {
        const rank = (x) => (x.status === 'failed' ? 0 : x.status === 'pending' ? 1 : 2);
        return rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at);
      }
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });
  const subFiltersActive = subFilter !== 'all' || subQuery.trim() !== '' || subSort !== 'newest';

  // How long a pending submission has been sitting. Surfaced from day 2 — one
  // that arrived this morning is not a backlog.
  const waitingDays = (sub) =>
    Math.floor((Date.now() - new Date(sub.created_at).getTime()) / 86400000);
  const staleSubs = pendingSubs.filter(x => waitingDays(x) >= 2);

  const exportSubs = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Name', 'Email', 'Specialty', 'Institution', 'City', 'Status', 'Has CV', 'Via link', 'Submitted'];
    const rows = sortedSubs.map(x => [
      x.full_name, x.email, x.specialty, x.institution, x.city,
      x.status, x.has_cv ? 'Yes' : 'No', x.form_link_title,
      x.created_at ? new Date(x.created_at).toLocaleString() : '',
    ]);
    const body = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'form-submissions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1, marginLeft: 8 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><XCircle size={16} /></button>
        </div>
      )}

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 24 }}>
        <div className="stat-card"><div className="stat-icon primary"><LinkIcon size={20} /></div><div className="stat-label">Active Links</div><div className="stat-value">{links.filter(l => l.is_active).length}</div></div>
        <div className="stat-card"><div className="stat-icon warning"><FileText size={20} /></div><div className="stat-label">Pending</div><div className="stat-value">{pendingSubs.length}</div></div>
        <div className="stat-card"><div className="stat-icon success"><CheckCircle size={20} /></div><div className="stat-label">Assessed</div><div className="stat-value">{assessedSubs.length}</div></div>
        <div className="stat-card"><div className="stat-icon info"><Users size={20} /></div><div className="stat-label">Total Submissions</div><div className="stat-value">{submissions.length}</div></div>
      </div>

      {/* Form Links */}
      <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LinkIcon size={16} style={{ color: 'var(--color-primary)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Form Link</h4>
            <span style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary)', padding: '1px 8px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600 }}>{links.length}</span>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={13} /> Generate Link
          </button>
        </div>
        <div style={{ padding: showCreate ? '16px 20px 0' : 0 }}>
          {showCreate && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
              <input className="form-control" style={{ flex: 1 }} placeholder="Form title (optional)"
                value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader size={14} className="spinning" /> : 'Create'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          )}

          {links.length === 0 && !showCreate ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <LinkIcon size={22} style={{ color: 'var(--color-primary)' }} />
              </div>
              <p style={{ margin: 0 }}>No form links yet. Generate one to share with others.</p>
            </div>
          ) : links.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {links.map((link, idx) => (
                <div key={link.id} className="fl-link"
                  style={{ borderBottom: idx < links.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}>
                  <div className="fl-link-top">
                    <span className={`fl-state${link.is_active ? ' is-on' : ''}`}>
                      <span className="fl-dot" />
                      {link.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="fl-link-title">{link.title}</span>
                    <span className="fl-link-meta">
                      <strong>{link.submission_count}</strong> submission{link.submission_count === 1 ? '' : 's'}
                    </span>
                    <span className="fl-link-meta">
                      {new Date(link.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>

                    <div className="fl-link-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => window.open(`/form/${link.token}`, '_blank')} title="Open form">
                        <ExternalLink size={13} /> Open
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleToggle(link.id)}
                        title={link.is_active ? 'Deactivate — the link stops accepting submissions' : 'Activate'}>
                        {link.is_active ? <ToggleRight size={15} style={{ color: 'var(--color-success)' }} /> : <ToggleLeft size={15} />}
                      </button>
                      <button className="btn btn-sm btn-ghost fl-danger" onClick={() => handleDelete(link.id)} title="Delete link and its submissions">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* The full URL, selectable. A truncated "/form/75ef3968…"
                      cannot be read off the screen or pasted anywhere — the
                      only thing you ever do with a form link is send it. */}
                  <div className="fl-url">
                    <input className="fl-url-input" readOnly value={`${window.location.origin}/form/${link.token}`}
                      onFocus={e => e.target.select()} aria-label={`Share link for ${link.title}`} />
                    <button className="btn btn-sm btn-secondary" onClick={() => copyLink(link.token)}>
                      {copiedId === link.token
                        ? <><CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> Copied</>
                        : <><Link2 size={13} /> Copy link</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* A queue with nothing chasing it quietly grows. Only shown when
          something has actually been waiting. */}
      {staleSubs.length > 0 && (
        <div className="fl-backlog">
          <AlertCircle size={16} />
          <span>
            <strong>{staleSubs.length}</strong> submission{staleSubs.length === 1 ? ' has' : 's have'} been
            waiting {Math.max(...staleSubs.map(waitingDays))} day
            {Math.max(...staleSubs.map(waitingDays)) === 1 ? '' : 's'} to be assessed.
          </span>
          <button type="button" className="btn btn-sm btn-secondary"
            onClick={() => { setSubFilter('pending'); setSubSort('oldest'); }}>
            Show oldest first
          </button>
        </div>
      )}

      {/* Submissions */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="fl-head" style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} style={{ color: 'var(--color-primary)' }} />
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Submissions</h4>
          <span style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary)', padding: '1px 8px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600 }}>{submissions.length}</span>

          {/* A queue you work through needs to be filterable — "which ones
              still need assessing" was previously a manual scan. */}
          {submissions.length > 0 && (
            <div className="fl-tools">
              <div className="filter-pills">
                {[['all', 'All', submissions.length],
                  ['pending', 'To assess', pendingSubs.length],
                  ['assessed', 'Assessed', assessedSubs.length]].map(([key, label, n]) => (
                  <button key={key} type="button"
                    className={`filter-pill${subFilter === key ? ' is-active' : ''}`}
                    onClick={() => setSubFilter(key)}>
                    {label}<span className="filter-pill-count">{n}</span>
                  </button>
                ))}
              </div>
              <div className="filter-search fl-search">
                <Search size={15} />
                <input className="form-control" placeholder="Search submissions..."
                  value={subQuery} onChange={e => setSubQuery(e.target.value)} />
              </div>
              <select className="form-control filter-select" value={subSort}
                onChange={e => setSubSort(e.target.value)} aria-label="Sort submissions">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="status">To assess first</option>
                <option value="name">Name A\u2013Z</option>
              </select>

              <button type="button" className="btn btn-secondary btn-sm" onClick={exportSubs}
                disabled={sortedSubs.length === 0}>
                <Download size={14} /> Export
              </button>

              {subFiltersActive && (
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setSubFilter('all'); setSubQuery(''); setSubSort('newest'); }}>
                  <XCircle size={14} /> Clear
                </button>
              )}
            </div>
          )}
        </div>

        {submissions.length > 0 && sortedSubs.length === 0 ? (
          <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            No submissions match your filters.
          </div>
        ) : submissions.length === 0 ? (
          <div className="fl-empty">
            <FileText size={20} />
            <div>
              <strong>No submissions yet</strong>
              <span>
                {links.some(l => l.is_active)
                  ? 'Send an active form link to an HCP — their answers land here ready to assess.'
                  : 'Generate a form link above, then share it to start collecting HCP details.'}
              </span>
            </div>
            {links.filter(l => l.is_active)[0] && (
              <button className="btn btn-sm btn-secondary" onClick={() => copyLink(links.filter(l => l.is_active)[0].token)}>
                {copiedId === links.filter(l => l.is_active)[0].token
                  ? <><CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> Copied</>
                  : <><Link2 size={13} /> Copy a link</>}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sortedSubs.map((sub, idx) => (
              <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px',
                borderBottom: idx < sortedSubs.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}>
                {/* Number */}
                <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: sub.status === 'assessed' ? 'var(--color-success-bg)' : sub.status === 'pending' ? 'var(--color-warning-bg)' : sub.status === 'failed' ? 'var(--color-error-bg)' : 'var(--color-info-bg)',
                  fontSize: '0.78rem', fontWeight: 700,
                  color: sub.status === 'assessed' ? 'var(--color-success-text)' : sub.status === 'pending' ? 'var(--color-warning-text)' : sub.status === 'failed' ? 'var(--color-error-text)' : 'var(--color-info-text)',
                }}>
                  {idx + 1}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>{sub.full_name || 'Unknown'}</span>
                    {getStatusBadge(sub.status)}
                    {sub.has_cv && <FileText size={13} style={{ color: 'var(--color-primary)' }} title="Has CV" />}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {sub.specialty && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Star size={11} style={{ color: 'var(--color-primary-light)' }} /> {sub.specialty}
                      </span>
                    )}
                    {sub.institution && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Building2 size={11} style={{ color: 'var(--color-text-light)' }} /> {sub.institution}
                      </span>
                    )}
                    {sub.form_link_title && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>via {sub.form_link_title}</span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Calendar size={10} /> {new Date(sub.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                    {(sub.status === 'pending' || sub.status === 'failed') && waitingDays(sub) >= 2 && (
                      <span className="fl-waiting">waiting {waitingDays(sub)} days</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {(sub.status === 'pending' || sub.status === 'failed') && (
                    <button className="btn btn-sm btn-primary" onClick={() => handleStartAssessment(sub.id)} disabled={processingId === sub.id}>
                      {processingId === sub.id ? <><Loader size={13} className="spinning" /> Processing</> : <><Brain size={13} /> Assess</>}
                    </button>
                  )}
                  {sub.status === 'assessed' && sub.hcp_id && (
                    <Link to={`/hcp/${sub.hcp_id}/results`} className="btn btn-sm btn-outline">
                      <Eye size={13} /> Results
                    </Link>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => setViewSub(sub)} title="View Details"
                    style={{ color: 'var(--color-text-light)' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                    <Eye size={13} />
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleDeleteSubmission(sub.id)} title="Delete"
                    style={{ color: 'var(--color-text-light)' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Submission Modal */}
      {viewSub && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setViewSub(null)}>
          <div style={{
            background: 'var(--color-surface)', borderRadius: 12, width: '100%', maxWidth: 600,
            maxHeight: '80vh', overflow: 'auto', padding: '24px',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Submission Details</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} onClick={() => setViewSub(null)}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px 20px', fontSize: '0.88rem' }}>
              {[
                ['Full Name', viewSub.full_name],
                ['Email', viewSub.email],
                ['City', viewSub.city],
                ['Specialty', viewSub.specialty],
                ['Institution', viewSub.institution],
                ['Designation', viewSub.designation],
                ['Experience', viewSub.years_of_experience ? `${viewSub.years_of_experience} years` : '--'],
                ['Status', viewSub.status],
              ].map(([label, value], i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontWeight: 500 }}>{value || '--'}</div>
                </div>
              ))}
            </div>
            <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />
            {[
              ['Key Clinical Interests', viewSub.key_clinical_interests],
              ['Publications', viewSub.publications],
              ['Conference Presentations', viewSub.conference_presentations],
              ['Professional Memberships', viewSub.professional_memberships],
              ['Awards & Recognitions', viewSub.awards_recognitions],
            ].map(([label, value], i) => (
              <div key={i} style={{ marginBottom: 12, fontSize: '0.88rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                <div style={{ whiteSpace: 'pre-wrap', color: value ? 'var(--color-text)' : 'var(--color-border-strong)' }}>{value || '--'}</div>
              </div>
            ))}
            {viewSub.has_cv && (
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }}
                onClick={() => handleDownloadCV(viewSub.id, viewSub.full_name)}>
                <Download size={14} /> Download CV
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────
const TAB_KEYS = ['assessments', 'find-kols', 'form-links'];

export default function AssessmentsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingCount, setPendingCount] = useState(0);
  const [showFormLink, setShowFormLink] = useState(true);
  const [showFindKOLs, setShowFindKOLs] = useState(true);

  // The tab lives in the URL (?tab=find-kols) so a refresh, a bookmark, or the
  // browser back button all land on the tab the user was actually looking at.
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_KEYS.includes(tabParam) ? tabParam : 'assessments';

  const setActiveTab = useCallback((key) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (key === 'assessments') next.delete('tab');
      else next.set('tab', key);
      // Find KOLs' own sub-view (?view=pending) belongs to that tab only.
      if (key !== 'find-kols') next.delete('view');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const refreshPendingCount = useCallback(async () => {
    try {
      const res = await listFormSubmissions({ status: 'pending' });
      setPendingCount((res.data || []).length);
    } catch {}
  }, []);

  useEffect(() => {
    refreshPendingCount();
    const interval = setInterval(refreshPendingCount, 10000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  useEffect(() => {
    getMe().then(res => {
      const role = res.data.role;
      if (role === 'super_admin' || role === 'admin') return;
      // Prefer the API's granted ∩ selected set, as App.js does; the raw
      // selection ignores what an admin actually granted.
      let services = Array.isArray(res.data.effective_services) ? res.data.effective_services : null;
      if (!services) {
        try {
          services = res.data.allowed_services
            ? (typeof res.data.allowed_services === 'string' ? JSON.parse(res.data.allowed_services) : res.data.allowed_services)
            : null;
        } catch { services = null; }
      }
      if (!Array.isArray(services)) return; // no list stored = no restrictions
      if (!services.includes('assessment_forms')) {
        setShowFormLink(false);
        if (activeTab === 'form-links') setActiveTab('assessments');
      }
      if (!services.includes('find_kols')) {
        setShowFindKOLs(false);
        if (activeTab === 'find-kols') setActiveTab('assessments');
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="sr-only">Assessments</h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>Manage HCP profiles and KOL assessments</p>
        </div>
        {activeTab === 'assessments' && (
          <button className="btn btn-primary" onClick={() => navigate('/hcp/new')}>
            <Plus size={16} /> New Assessment
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--color-border)' }}>
        {[
          { key: 'assessments', label: 'Assessments', icon: ClipboardCheck, badge: 0 },
          ...(showFindKOLs ? [{ key: 'find-kols', label: 'Find KOLs', icon: UserSearch, badge: 0 }] : []),
          ...(showFormLink ? [{ key: 'form-links', label: 'Form Link', icon: LinkIcon, badge: pendingCount }] : []),
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
                border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: isActive ? 600 : 400, fontSize: '0.95rem',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s ease',
              }}>
              <Icon size={16} /> {tab.label}
              {tab.badge > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
                  fontSize: '0.7rem', fontWeight: 700, background: 'var(--color-error)', color: 'var(--color-text-inverse)', marginLeft: 4,
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'assessments' && <AssessmentsTab />}
      {activeTab === 'find-kols' && showFindKOLs && <FindKOLsTab />}
      {activeTab === 'form-links' && <FormLinksTab onCountChange={refreshPendingCount} />}
    </div>
  );
}
