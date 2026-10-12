import React, { useMemo } from 'react';
import { Search, Download, X, BarChart3, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * The status band, filter toolbar and insight cards shared by Surveys and
 * Polling. Both pages are the same shape — a list of items with a status, a
 * created date and a response count — so the analysis is written once here
 * rather than twice, slightly differently, on each page.
 *
 * The caller owns the filter state; this only renders and reports changes.
 */

const STATUS_TONE = {
  active: 'var(--color-success)',
  draft: 'var(--color-text-light)',
  closed: 'var(--color-info)',
  archived: 'var(--color-text-light)',
};

export function useEngagementStats(items, { countKey }) {
  return useMemo(() => {
    const count = (it) => it[countKey] || 0;
    const total = items.reduce((n, it) => n + count(it), 0);

    const statusCounts = items.reduce((acc, it) => {
      const k = it.status || 'draft';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    // Ordered so the bar reads draft → active → closed, the actual lifecycle.
    const ORDER = ['draft', 'active', 'closed', 'archived'];
    const statusRows = [
      ...ORDER.filter(k => statusCounts[k]).map(k => ({ key: k, count: statusCounts[k] })),
      // A status the order does not know about still shows rather than vanishing.
      ...Object.keys(statusCounts).filter(k => !ORDER.includes(k)).map(k => ({ key: k, count: statusCounts[k] })),
    ];

    const answered = items.filter(it => count(it) > 0);
    const topAnswered = [...answered].sort((a, b) => count(b) - count(a)).slice(0, 5);
    const topMax = Math.max(1, ...topAnswered.map(count));

    const live = items.filter(it => it.status === 'active');
    const gaps = [
      { key: 'draft', label: 'Draft — not launched', items: items.filter(it => (it.status || 'draft') === 'draft') },
      { key: 'silent', label: 'Live but no responses', items: live.filter(it => count(it) === 0) },
    ].filter(g => g.items.length > 0);

    return {
      total,
      statusCounts,
      statusRows,
      statusTotal: items.length,
      topAnswered,
      topMax,
      answeredCount: answered.length,
      avgPerItem: items.length ? (total / items.length).toFixed(1) : '0',
      avgPerAnswered: answered.length ? (total / answered.length).toFixed(1) : '0',
      gaps,
      count,
    };
  }, [items, countKey]);
}

export function StatusMix({ stats, noun, statusFilter, onStatusFilter }) {
  if (stats.statusTotal === 0) return null;
  return (
    <div className="card tier-mix">
      <div className="tier-mix-head">
        <span className="tier-mix-title">Status</span>
        <span className="tier-mix-total">{stats.statusTotal} {noun}</span>
      </div>
      <div className="tier-mix-bar">
        {stats.statusRows.map(r => (
          <span
            key={r.key}
            className="tier-mix-seg"
            style={{ width: `${(r.count / stats.statusTotal) * 100}%`, background: STATUS_TONE[r.key] || 'var(--color-text-light)' }}
            title={`${r.key}: ${r.count}`}
          />
        ))}
      </div>
      <div className="tier-mix-legend">
        {stats.statusRows.map(r => (
          <button
            type="button"
            key={r.key}
            className={`tier-mix-key${statusFilter === r.key ? ' is-active' : ''}`}
            onClick={() => onStatusFilter(statusFilter === r.key ? '' : r.key)}
          >
            <span className="tier-dot" style={{ background: STATUS_TONE[r.key] || 'var(--color-text-light)' }} />
            {r.key}
            <strong>{r.count}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EngagementCards({ stats, unit, onOpen }) {
  if (stats.statusTotal === 0) return null;
  return (
    <div className="insights-grid">
      {stats.topAnswered.length > 0 && (
        <div className="card insight-card">
          <div className="insight-head"><BarChart3 size={15} /> Most Answered</div>
          <div className="rank-list">
            {stats.topAnswered.map(it => (
              <button type="button" key={it.id} className="rank-row rank-row-btn" onClick={() => onOpen && onOpen(it)}>
                <span className="rank-label" title={it.title}>{it.title || 'Untitled'}</span>
                <span className="rank-track">
                  <span className="rank-fill" style={{ width: `${(stats.count(it) / stats.topMax) * 100}%` }} />
                </span>
                <span className="rank-count">{stats.count(it)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card insight-card">
        <div className="insight-head"><CheckCircle2 size={15} /> Engagement</div>
        <div className="rank-list">
          <div className="rank-row">
            <span className="rank-label">Received {unit}</span>
            <span className="rank-track">
              <span className="rank-fill" style={{ width: `${(stats.answeredCount / stats.statusTotal) * 100}%` }} />
            </span>
            <span className="rank-count">{stats.answeredCount}/{stats.statusTotal}</span>
          </div>
          <div className="rank-row">
            <span className="rank-label">Launched</span>
            <span className="rank-track">
              <span className="rank-fill" style={{ width: `${((stats.statusTotal - (stats.statusCounts.draft || 0)) / stats.statusTotal) * 100}%` }} />
            </span>
            <span className="rank-count">{stats.statusTotal - (stats.statusCounts.draft || 0)}/{stats.statusTotal}</span>
          </div>
        </div>
        <p className="insight-note">
          {stats.total} {unit} in total — an average of {stats.avgPerItem} each
          {stats.answeredCount > 0 && `, or ${stats.avgPerAnswered} across the ones that got any`}.
        </p>
      </div>
    </div>
  );
}

export function GapChips({ stats, onPick }) {
  if (stats.gaps.length === 0) return null;
  return (
    <div className="flag-chips">
      <span className="flag-chips-label"><AlertTriangle size={12} /> Needs attention</span>
      {stats.gaps.map(g => (
        <button
          type="button"
          key={g.key}
          className="flag-chip"
          onClick={() => onPick && onPick(g)}
          title={g.items.map(i => i.title).join(', ')}
        >
          {g.label}<strong>{g.items.length}</strong>
        </button>
      ))}
    </div>
  );
}

export function FilterBar({
  search, onSearch, statusFilter, onStatusFilter, statusRows,
  sortBy, onSort, sortOptions, onExport, exportDisabled,
  showing, totalCount, noun, onClear, filtersActive,
}) {
  return (
    <>
      <div className="filter-bar">
        <div className="filter-search">
          <Search size={16} />
          <input className="form-control" placeholder={`Search ${noun}...`} value={search} onChange={e => onSearch(e.target.value)} />
        </div>

        <select className="form-control filter-select" value={statusFilter} onChange={e => onStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {statusRows.map(r => <option key={r.key} value={r.key}>{r.key}</option>)}
        </select>

        <select className="form-control filter-select" value={sortBy} onChange={e => onSort(e.target.value)}>
          {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <button type="button" className="btn btn-secondary btn-sm" onClick={onExport} disabled={exportDisabled}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="filter-summary">
        <span>Showing <strong>{showing}</strong> of <strong>{totalCount}</strong> {noun}</span>
        {filtersActive && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
            <X size={14} /> Clear filters
          </button>
        )}
      </div>
    </>
  );
}

/** Every field quoted and inner quotes doubled — titles contain commas. */
export function downloadCsv(filename, header, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
