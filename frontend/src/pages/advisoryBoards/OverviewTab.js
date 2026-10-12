import React, { useEffect, useState } from 'react';
import { Briefcase, Calendar, Users, Receipt, Plus, ArrowRight, CheckCircle, Clock, ClipboardList, ExternalLink, AlertTriangle } from 'lucide-react';
import {
  listBoards, listKols, BOARD_STATUSES, BOARD_STATUS_BY_ID,
  PHASES, PHASE_BY_ID, SERVICES, estimateBoardCost, formatMoney,
} from './data';
import { listPendingPreMeetingSurveys, getAccountConfigStatus, listAllMeetings } from '../../services/api';

export default function OverviewTab({ onOpenBoard, onTab }) {
  const [boards, setBoards] = useState([]);
  const [kols, setKols] = useState([]);
  const [meetings, setMeetings] = useState([]);

  useEffect(() => {
    let cancelled = false;
    listBoards()
      .then(b => { if (!cancelled) setBoards(b); })
      .catch(() => { /* show empty state on failure */ });
    // Meetings are the point of an advisory board, and this tab never asked for
    // them — the whole calendar side of the module was invisible here.
    listAllMeetings({})
      .then(r => { if (!cancelled) setMeetings(r.data || []); })
      .catch(() => { /* leave empty */ });
    setKols(listKols());
    return () => { cancelled = true; };
  }, []);

  const totalBoards = boards.length;
  // ⚠️ Was `in_progress || scheduled`, which excluded 'planning' — a real status
  // and the one most boards start in. A board sitting in Planning showed up in
  // the Upcoming panel directly below while this tile read 0.
  // "In pipeline" now means the same thing here as it does for pipelineValue:
  // everything that is neither finished nor abandoned.
  const activeCount = boards.filter(b => !['completed', 'cancelled'].includes(b.status)).length;
  const completedCount = boards.filter(b => b.status === 'completed').length;
  const totalKols = kols.length;
  // A service is "priced" once its catalog row has a non-zero default_price.
  const pricedCount = SERVICES.filter((s) => Number(s.defaultPrice) > 0).length;

  // pipeline value across all non-cancelled boards
  const pipelineValue = boards
    .filter(b => b.status !== 'cancelled')
    .reduce((sum, b) => sum + (estimateBoardCost(b).total || 0), 0);

  // upcoming = scheduled or planning, sorted by scheduledDate ascending
  const upcoming = boards
    .filter(b => ['planning', 'scheduled', 'in_progress'].includes(b.status))
    .sort((a, b) => {
      const da = a.scheduledDate ? new Date(a.scheduledDate).getTime() : Infinity;
      const db = b.scheduledDate ? new Date(b.scheduledDate).getTime() : Infinity;
      return da - db;
    })
    .slice(0, 5);

  // boards by phase distribution
  const phaseCounts = {};
  for (const p of PHASES) phaseCounts[p.id] = 0;
  for (const b of boards) if (phaseCounts[b.currentPhase] !== undefined) phaseCounts[b.currentPhase]++;

  // status distribution
  const statusCounts = BOARD_STATUSES.map(s => ({ ...s, count: boards.filter(b => b.status === s.id).length })).filter(s => s.count > 0);

  // ── Meetings ──
  const now = Date.now();
  const liveMeetings = meetings.filter(m => m.status === 'live');
  const upcomingMeetings = meetings
    .filter(m => m.status !== 'completed' && m.status !== 'cancelled' && m.scheduled_at && new Date(m.scheduled_at).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const thisMonthMeetings = meetings.filter(m => {
    if (!m.scheduled_at) return false;
    const d = new Date(m.scheduled_at), t = new Date();
    return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  }).length;
  // Live first, then soonest — a call happening right now outranks tomorrow's.
  const meetingFeed = [...liveMeetings, ...upcomingMeetings.filter(m => m.status !== 'live')].slice(0, 5);

  // ── Coverage ──
  const tally = (list) => {
    const acc = {};
    list.forEach(v => { if (v) acc[v] = (acc[v] || 0) + 1; });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  };
  const taCounts = tally(boards.flatMap(b => b.therapeuticArea || [])).slice(0, 5);
  const taMax = Math.max(1, ...taCounts.map(([, n]) => n));
  const clientCounts = tally(boards.map(b => b.client)).slice(0, 5);
  const clientMax = Math.max(1, ...clientCounts.map(([, n]) => n));

  // ── Top boards by estimated value ──
  const boardsByValue = boards
    .filter(b => b.status !== 'cancelled')
    .map(b => ({ board: b, value: estimateBoardCost(b).total || 0 }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const valueMax = Math.max(1, ...boardsByValue.map(x => x.value));

  // ── Readiness: what a board is missing before it can actually run ──
  const boardIdsWithMeetings = new Set(meetings.map(m => m.board_id).filter(Boolean));
  const live = boards.filter(b => !['completed', 'cancelled'].includes(b.status));
  const readiness = [
    { key: 'meeting', label: 'Meeting scheduled', have: live.filter(b => boardIdsWithMeetings.has(b.id) || b.primaryMeeting).length },
    { key: 'kols', label: 'KOLs attached', have: live.filter(b => (b.kolIds || []).length > 0).length },
    { key: 'services', label: 'Services selected', have: live.filter(b => (b.serviceIds || []).length > 0).length },
    { key: 'objective', label: 'Objective written', have: live.filter(b => (b.objective || '').trim()).length },
  ];

  const gaps = [
    { key: 'no_meeting', label: 'No meeting scheduled', items: live.filter(b => !boardIdsWithMeetings.has(b.id) && !b.primaryMeeting) },
    { key: 'no_kols', label: 'No KOLs attached', items: live.filter(b => (b.kolIds || []).length === 0) },
    { key: 'no_objective', label: 'No objective set', items: live.filter(b => !(b.objective || '').trim()) },
  ].filter(g => g.items.length > 0);

  const fmtWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      {/* KPI Cards */}
      <div className="stats-row" style={{ marginBottom: 22 }}>
        <Stat icon={<Briefcase size={20} />} colorClass="primary" label="Total Boards" value={totalBoards} />
        <Stat icon={<Clock size={20} />}     colorClass="warning" label="In Pipeline" value={activeCount} sub={`${completedCount} completed`} />
        <Stat icon={<Users size={20} />}     colorClass="success" label="KOLs in Directory" value={totalKols} />
        <Stat icon={<Receipt size={20} />}   colorClass="info"    label="Pipeline Value" value={pipelineValue > 0 ? formatMoney(pipelineValue, 'USD') : '—'} sub={`${pricedCount}/${SERVICES.length} services priced`} />
        <Stat icon={<Calendar size={20} />}  colorClass="info"    label="Upcoming Meetings"
              value={upcomingMeetings.length}
              sub={liveMeetings.length ? `${liveMeetings.length} live now` : `${thisMonthMeetings} this month`} />
      </div>

      <ConfigPendingBanner />

      <PendingSurveysWidget />

      {/* Meetings — the calendar side of the module, which this tab never showed. */}
      {meetingFeed.length > 0 && (
        <div className="card ab-panel">
          <div className="ab-panel-head">
            <span><Calendar size={15} /> Upcoming &amp; Live Meetings</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onTab && onTab('meetings')}>
              All meetings <ArrowRight size={12} />
            </button>
          </div>
          <div className="ab-list">
            {meetingFeed.map(m => (
              <div className="ab-row" key={m.id}>
                <span className="ab-row-main">
                  <span className="ab-row-title">{m.title || 'Untitled meeting'}</span>
                  <span className="ab-row-meta">
                    {[m.board_title, fmtWhen(m.scheduled_at), m.format].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {m.status === 'live'
                  ? <span className="ab-live">● Live</span>
                  : <span className="ab-row-meta">{m.participant_count ?? 0} invited</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {boards.length > 0 && (
        <div className="insights-grid">
          {boardsByValue.length > 0 && (
            <div className="card insight-card">
              <div className="insight-head"><Receipt size={15} /> Boards by Value</div>
              <div className="rank-list">
                {boardsByValue.map(({ board, value }) => (
                  <button type="button" key={board.id} className="rank-row rank-row-btn" onClick={() => onOpenBoard && onOpenBoard(board.id)}>
                    <span className="rank-label" title={board.title}>{board.title}</span>
                    <span className="rank-track">
                      <span className="rank-fill" style={{ width: `${(value / valueMax) * 100}%` }} />
                    </span>
                    <span className="rank-count">{formatMoney(value, board.currency || 'USD')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Therapeutic areas and clients share one card. Split across two, a
              portfolio with a single area and a single client left two mostly
              empty boxes standing next to a four-row card. */}
          {(taCounts.length > 0 || clientCounts.length > 0) && (
            <div className="card insight-card">
              <div className="insight-head"><ClipboardList size={15} /> Portfolio Coverage</div>
              {taCounts.length > 0 && (
                <>
                  <div className="insight-subhead">Therapeutic areas</div>
                  <div className="rank-list">
                    {taCounts.map(([ta, n]) => (
                      <div className="rank-row" key={ta}>
                        <span className="rank-label" title={ta}>{ta}</span>
                        <span className="rank-track"><span className="rank-fill" style={{ width: `${(n / taMax) * 100}%` }} /></span>
                        <span className="rank-count">{n}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {clientCounts.length > 0 && (
                <>
                  <div className="insight-subhead">Clients</div>
                  <div className="rank-list">
                    {clientCounts.map(([c, n]) => (
                      <div className="rank-row" key={c}>
                        <span className="rank-label" title={c}>{c}</span>
                        <span className="rank-track"><span className="rank-fill" style={{ width: `${(n / clientMax) * 100}%` }} /></span>
                        <span className="rank-count">{n}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {live.length > 0 && (
            <div className="card insight-card">
              <div className="insight-head"><CheckCircle size={15} /> Board Readiness</div>
              <div className="rank-list">
                {readiness.map(r => (
                  <div className="rank-row" key={r.key}>
                    <span className="rank-label" title={r.label}>{r.label}</span>
                    <span className="rank-track"><span className="rank-fill" style={{ width: `${(r.have / live.length) * 100}%` }} /></span>
                    <span className="rank-count">{r.have}/{live.length}</span>
                  </div>
                ))}
              </div>
              <p className="insight-note">
                Across the {live.length} board{live.length === 1 ? '' : 's'} still in flight.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Gaps — each one is a board that cannot run yet. */}
      {gaps.length > 0 && (
        <div className="flag-chips">
          <span className="flag-chips-label">Needs attention</span>
          {gaps.map(g => (
            <button type="button" key={g.key} className="flag-chip"
              onClick={() => onOpenBoard && onOpenBoard(g.items[0].id)}
              title={g.items.map(b => b.title).join(', ')}>
              {g.label}<strong>{g.items.length}</strong>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* Upcoming */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Upcoming Boards</h4>
            <button className="btn btn-sm btn-ghost" onClick={() => onTab?.('boards')}>View all <ArrowRight size={12} /></button>
          </div>
          {upcoming.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              <Calendar size={28} style={{ color: 'var(--color-text-light)', marginBottom: 6 }} />
              <p style={{ margin: '0 0 10px', fontSize: '0.88rem' }}>No advisory boards in the pipeline.</p>
              <button className="btn btn-sm btn-primary" onClick={() => onTab?.('boards')}><Plus size={13} /> Create one</button>
            </div>
          ) : (
            <div>
              {upcoming.map(b => {
                const phase = PHASE_BY_ID[b.currentPhase];
                const status = BOARD_STATUS_BY_ID[b.status];
                const date = b.scheduledDate ? new Date(b.scheduledDate).toLocaleDateString() : 'TBD';
                return (
                  <button key={b.id} onClick={() => onOpenBoard?.(b.id)} style={{
                    width: '100%', textAlign: 'left', padding: '12px 18px', border: 'none', background: 'transparent',
                    borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ width: 3, alignSelf: 'stretch', background: phase.color, borderRadius: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                        {b.client || 'No client'} • {date} • <span style={{ color: phase.color, fontWeight: 600 }}>{phase.label}</span>
                      </div>
                    </div>
                    <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, background: `${status.color}1A`, color: status.color, flexShrink: 0 }}>
                      {status.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Phase distribution */}
        <div className="card" style={{ padding: 18 }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 12 }}>Boards by Engagement Phase</h4>
          {totalBoards === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.88rem' }}>No data yet — create boards to see distribution.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {PHASES.map(p => {
                const c = phaseCounts[p.id];
                const pct = totalBoards ? (c / totalBoards) * 100 : 0;
                return (
                  <div key={p.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                      <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{p.label}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{c}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--color-surface-raised)', borderRadius: 999 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: p.color, borderRadius: 999, transition: 'width var(--transition)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Status distribution */}
        <div className="card" style={{ padding: 18 }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 12 }}>Status Mix</h4>
          {statusCounts.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.88rem' }}>No boards yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {statusCounts.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                  <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--color-text)' }}>{s.label}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{s.count}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              <CheckCircle size={11} style={{ verticalAlign: 'middle', marginRight: 3, color: 'var(--color-success)' }} />
              {completedCount} completed all-time
            </span>
            <button className="btn btn-sm btn-outline" onClick={() => onTab?.('boards')}>Manage <ArrowRight size={12} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Nudges the account holder to set up their own SMTP / meeting-platform config.
// While unset, sends/meetings use the platform default (so nothing breaks), but
// we surface the pending setup here per the SaaS onboarding flow.
function ConfigPendingBanner() {
  const [pending, setPending] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getAccountConfigStatus()
      .then(r => {
        if (cancelled) return;
        const s = r.data || {};
        const missing = [];
        if (s.smtp?.source !== 'account') missing.push({ label: 'Email (SMTP)', tab: 'email-smtp' });
        if (s.zoom?.source !== 'account' && s.teams?.source !== 'account') {
          missing.push({ label: 'Meeting platform (Zoom/Teams)', tab: 'meeting-platforms' });
        }
        setPending(missing);
      })
      .catch(() => { /* config endpoint optional — stay silent on failure */ });
    return () => { cancelled = true; };
  }, []);

  if (pending.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18,
      padding: '12px 16px', borderRadius: 10, background: 'var(--color-warning-bg)',
      border: '1px solid var(--color-warning)', color: 'var(--color-warning-text)',
    }}>
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: '0.88rem' }}>
        <strong>Finish setting up your account.</strong> You haven't configured{' '}
        {pending.map((p, i) => (
          <React.Fragment key={p.tab}>
            {i > 0 && (i === pending.length - 1 ? ' and ' : ', ')}
            <a href={`/account#${p.tab}`} style={{ color: 'var(--color-warning-text)', fontWeight: 600 }}>{p.label}</a>
          </React.Fragment>
        ))}
        {' '}yet — until then, the platform default is used for your emails and meeting links.
      </div>
    </div>
  );
}

function PendingSurveysWidget() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPendingPreMeetingSurveys()
      .then(r => { if (!cancelled) { setItems(r.data || []); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Hide entirely if nothing pending — keeps overview tidy
  if (!loaded || items.length === 0) return null;

  return (
    <div className="card" style={{ padding: 0, marginBottom: 22, overflow: 'hidden', borderLeft: '3px solid var(--color-primary)' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ClipboardList size={16} style={{ color: 'var(--color-primary)' }} />
        <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-primary-dark)' }}>
          {items.length} pre-meeting survey{items.length === 1 ? '' : 's'} waiting for your input
        </h4>
      </div>
      <div>
        {items.map(it => {
          const url = `${window.location.origin}/survey/${it.survey_token}`;
          const when = it.meeting_scheduled_at ? new Date(it.meeting_scheduled_at).toLocaleString() : 'Date TBD';
          return (
            <div key={it.link_id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.survey_title}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                  For "{it.meeting_title}" • {when}
                </div>
              </div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">
                Fill survey <ExternalLink size={12} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ icon, colorClass, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${colorClass}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
