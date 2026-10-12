import React, { useEffect, useState } from 'react';
import {
  Calendar, Plus, ArrowRight, Clock, Video, MapPin, Users, X, Loader, Briefcase, Trash2,
  Search, Download, AlertTriangle,
} from 'lucide-react';
import {
  listAllMeetings, listAdvisoryBoards, createAdvisoryBoard, createMeeting,
  getAccountConfigStatus, deleteMeeting, getMe,
} from '../../services/api';
import { boardMeetingTimeDefaults } from './data';

const STATUS_COLORS = {
  scheduled: 'var(--color-info)',
  live:      'var(--color-success)',
  completed: 'var(--color-text-secondary)',
  cancelled: 'var(--color-error)',
};
const STATUS_LABELS = {
  scheduled: 'Scheduled',
  live:      'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const FORMAT_ICONS = { in_person: MapPin, virtual: Video, hybrid: Video };

/** "Live now" / "in 3 days" / "2 hours ago" — a bare timestamp makes you count. */
function relativeWhen(date, status) {
  if (status === 'live') return 'Live now';
  if (!date) return '';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const unit =
    mins < 60 ? `${mins} min`
    : abs < 86400000 ? `${Math.round(mins / 60)} hr`
    : abs < 2592000000 ? `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'}`
    : `${Math.round(mins / 43200)} mo`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export default function MeetingsTab({ onOpenMeeting }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');   // all | upcoming | live | completed
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('soonest');
  const [showCreate, setShowCreate] = useState(false);
  const [role, setRole] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Only platform admins / account holders get the delete control. The backend
  // enforces the full rule (admin, organizer, board owner, meetings.manage).
  const canDelete = role === 'super_admin' || role === 'admin';

  useEffect(() => {
    getMe().then(r => setRole(r.data?.role)).catch(() => setRole(null));
  }, []);

  const removeMeeting = async (m) => {
    if (deletingId) return;
    if (!window.confirm(`Delete meeting "${m.title}"? This also removes it from ${m.join_url ? 'the meeting platform (Zoom/Teams) and ' : ''}the board. This cannot be undone.`)) return;
    setDeletingId(m.id);
    try {
      await deleteMeeting(m.id);
      setMeetings(prev => prev.filter(x => x.id !== m.id));
    } catch (e) {
      alert(e.response?.data?.detail || e.message || 'Failed to delete meeting');
    } finally {
      setDeletingId(null);
    }
  };

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      // Everything, once. Filtering here rather than per-pill on the server is
      // what lets the pills carry real counts and the summary say "N of M".
      const r = await listAllMeetings({});
      setMeetings(r.data || []);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const now = Date.now();
  const at = (m) => (m.scheduled_at ? new Date(m.scheduled_at).getTime() : null);
  const isUpcoming = (m) => m.status === 'scheduled' && at(m) !== null && at(m) >= now;

  const counts = {
    all: meetings.length,
    upcoming: meetings.filter(isUpcoming).length,
    live: meetings.filter(m => m.status === 'live').length,
    completed: meetings.filter(m => m.status === 'completed').length,
  };

  const stats = {
    participants: meetings.reduce((n, m) => n + (m.participant_count || 0), 0),
    // Only future sessions — hours already spent are not what you are planning.
    hours: Math.round(meetings.filter(isUpcoming).reduce((n, m) => n + (m.duration_minutes || 60), 0) / 6) / 10,
    boards: new Set(meetings.map(m => m.board_title).filter(Boolean)).size,
    undated: meetings.filter(m => at(m) === null).length,
    noParticipants: meetings.filter(m => !(m.participant_count > 0)).length,
  };

  const matchesFilter = (m) => {
    if (filter === 'upcoming') return isUpcoming(m);
    if (filter === 'live' || filter === 'completed') return m.status === filter;
    return true;
  };

  const filtered = meetings.filter(m => {
    if (!matchesFilter(m)) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return [m.title, m.board_title, m.agenda_summary].some(v => (v || '').toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'latest':       return (at(b) ?? -Infinity) - (at(a) ?? -Infinity);
      case 'title':        return (a.title || '').localeCompare(b.title || '');
      case 'board':        return (a.board_title || '').localeCompare(b.board_title || '');
      case 'participants': return (b.participant_count || 0) - (a.participant_count || 0);
      // Soonest first, undated last rather than pretending they are at epoch 0.
      default:             return (at(a) ?? Infinity) - (at(b) ?? Infinity);
    }
  });

  // A meetings list is read by date, so it is grouped by date. Buckets are
  // ordered by the lifecycle a user thinks in, not alphabetically.
  const BUCKETS = ['Live now', 'Today', 'Tomorrow', 'This week', 'Later', 'Past', 'Date TBD'];
  const bucketFor = (m) => {
    if (m.status === 'live') return 'Live now';
    const t = at(m);
    if (t === null) return 'Date TBD';
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const days = Math.floor((t - startOfToday.getTime()) / 86400000);
    if (days < 0) return 'Past';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days <= 7) return 'This week';
    return 'Later';
  };
  const groups = BUCKETS
    .map(label => ({ label, items: sorted.filter(m => bucketFor(m) === label) }))
    .filter(g => g.items.length > 0);

  const filtersActive = filter !== 'all' || query.trim() !== '' || sortBy !== 'soonest';
  const clearFilters = () => { setFilter('all'); setQuery(''); setSortBy('soonest'); };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Title', 'Board', 'Status', 'Scheduled', 'Duration (min)', 'Format', 'Participants'];
    const rows = sorted.map(m => [
      m.title, m.board_title || '', STATUS_LABELS[m.status] || m.status,
      m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : '',
      m.duration_minutes || 60, m.format || '', m.participant_count || 0,
    ]);
    const body = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'meetings.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="filter-bar">
        <div className="filter-pills">
          {['all', 'upcoming', 'live', 'completed'].map(f => (
            <button key={f} type="button"
              className={`filter-pill${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="filter-pill-count">{counts[f]}</span>
            </button>
          ))}
        </div>

        <div className="filter-search">
          <Search size={16} />
          <input className="form-control" placeholder="Search meetings..."
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>

        <select className="form-control filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="soonest">Soonest first</option>
          <option value="latest">Most recent first</option>
          <option value="title">Title A–Z</option>
          <option value="board">By board</option>
          <option value="participants">Most participants</option>
        </select>

        <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={sorted.length === 0}>
          <Download size={15} /> Export CSV
        </button>

        <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New Meeting
        </button>
      </div>

      {/* At-a-glance band. The page previously carried one row and a lot of
          white space; these are numbers the list already holds. */}
      {meetings.length > 0 && (
        <div className="mt-stats">
          <div className="mt-stat">
            <span className="mt-stat-label"><Calendar size={12} /> Scheduled ahead</span>
            <span className="mt-stat-value">{counts.upcoming}</span>
          </div>
          <div className="mt-stat">
            <span className="mt-stat-label"><Clock size={12} /> Hours booked</span>
            <span className="mt-stat-value">{stats.hours}</span>
          </div>
          <div className="mt-stat">
            <span className="mt-stat-label"><Users size={12} /> Participant seats</span>
            <span className="mt-stat-value">{stats.participants}</span>
          </div>
          <div className="mt-stat">
            <span className="mt-stat-label"><Briefcase size={12} /> Boards covered</span>
            <span className="mt-stat-value">{stats.boards}</span>
          </div>
        </div>
      )}

      {/* Only what needs doing — silent when there is nothing wrong. */}
      {meetings.length > 0 && (stats.undated > 0 || stats.noParticipants > 0) && (
        <div className="flag-chips">
          <span className="flag-chips-label"><AlertTriangle size={12} /> Needs attention</span>
          {stats.undated > 0 && (
            <span className="flag-chip">No date set<strong>{stats.undated}</strong></span>
          )}
          {stats.noParticipants > 0 && (
            <span className="flag-chip">No participants invited<strong>{stats.noParticipants}</strong></span>
          )}
        </div>
      )}

      {meetings.length > 0 && (
        <div className="filter-summary">
          <span>Showing <strong>{sorted.length}</strong> of <strong>{meetings.length}</strong> meeting{meetings.length === 1 ? '' : 's'}</span>
          {filtersActive && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <Loader size={20} className="spin" /> Loading meetings…
        </div>
      ) : error ? (
        <div className="card" style={{ padding: 20, borderLeft: '3px solid var(--color-danger, var(--color-error))' }}>
          <strong>Couldn't load meetings.</strong>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>{error}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: 8 }}>
            If you just added MABM tables, restart the backend so they get created.
          </div>
        </div>
      ) : meetings.length === 0 ? (
        <div className="card" style={{ padding: 50, textAlign: 'center' }}>
          <Calendar size={36} style={{ color: 'var(--color-text-light)', marginBottom: 10 }} />
          <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>No meetings yet</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
            Schedule your first MABM session — pre-meeting docs, live agenda, post-meeting transcript.
          </p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Create your first meeting
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          No meetings match your filters.
        </div>
      ) : (
        <div className="mt-groups">
          {groups.map(group => (
            <section className="mt-group" key={group.label}>
              <div className="mt-group-head">
                <h3 className="mt-group-title">{group.label}</h3>
                <span className="mt-group-count">{group.items.length}</span>
              </div>
              <div className="card mt-list">
                {group.items.map(m => {
                  const FmtIcon = FORMAT_ICONS[m.format] || Video;
                  const when = m.scheduled_at ? new Date(m.scheduled_at) : null;
                  const tone = STATUS_COLORS[m.status] || 'var(--color-text-secondary)';
                  const joinable = m.video_provider === 'livekit' || m.join_url;
                  const gaps = [
                    !when && 'No date',
                    !(m.participant_count > 0) && 'No participants',
                  ].filter(Boolean);
                  return (
                    <div className="mt-row" key={m.id}>
                      <button className="mt-row-main" onClick={() => onOpenMeeting?.(m.id)}>
                        <span className="mt-icon" style={{ background: `${tone}1A`, color: tone }}>
                          <FmtIcon size={18} />
                        </span>
                        <span className="mt-body">
                          <span className="mt-title-row">
                            <span className="mt-title">{m.title}</span>
                            <span className="mt-status" style={{ background: `${tone}1A`, color: tone }}>
                              {STATUS_LABELS[m.status] || m.status}
                            </span>
                          </span>
                          <span className="mt-meta">
                            <span><Briefcase size={11} /> {m.board_title || 'Unassigned board'}</span>
                            <span><Clock size={11} /> {when ? when.toLocaleString() : 'Date TBD'}</span>
                            <span><Users size={11} /> {m.participant_count || 0}</span>
                            <span>{m.duration_minutes || 60} min</span>
                          </span>
                          {gaps.length > 0 && (
                            <span className="mt-gaps">
                              {gaps.map(g => (
                                <span className="board-gap" key={g}><AlertTriangle size={11} /> {g}</span>
                              ))}
                            </span>
                          )}
                        </span>
                        {/* The status chip already says "Live", so the time
                            column would only repeat it. */}
                        {m.status !== 'live' && (
                          <span className="mt-when">{relativeWhen(when, m.status)}</span>
                        )}
                      </button>

                      <div className="mt-actions">
                        {joinable && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => window.open(`/meeting-room/${m.id}`, '_blank')}
                            title="Join in this app"
                          >
                            <Video size={13} /> Join
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="mt-icon-btn is-danger"
                            onClick={() => removeMeeting(m)}
                            disabled={deletingId === m.id}
                            title="Delete meeting (also removes it from Zoom/Teams)"
                          >
                            {deletingId === m.id ? <Loader size={15} className="spin" /> : <Trash2 size={15} />}
                          </button>
                        )}
                        <button className="mt-icon-btn" onClick={() => onOpenMeeting?.(m.id)} title="Open meeting">
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateMeetingModal
          onClose={() => setShowCreate(false)}
          onCreated={(newMeetingId) => {
            setShowCreate(false);
            reload();
            if (newMeetingId) onOpenMeeting?.(newMeetingId);
          }}
        />
      )}
    </div>
  );
}

// ── Create Meeting Modal ─────────────────────────────────

export function CreateMeetingModal({ onClose, onCreated }) {
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardId, setBoardId] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [format, setFormat] = useState('virtual');
  const [joinUrl, setJoinUrl] = useState('');
  const [autoZoom, setAutoZoom] = useState(false);
  const [zoomActive, setZoomActive] = useState(false);
  // The account's chosen platform — the form follows it rather than always
  // asking for Zoom details.
  const [activeProvider, setActiveProvider] = useState(null);
  const [cfgStatus, setCfgStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await listAdvisoryBoards();
        setBoards(r.data || []);
        if (r.data && r.data.length > 0) setBoardId(String(r.data[0].id));
      } catch (e) {
        setErr(e.response?.data?.detail || e.message);
      } finally {
        setBoardsLoading(false);
      }
    })();
    // Account-only: auto-create Zoom is offered only when THIS account has its own
    // Zoom config (platform default isn't auto-used for provisioning).
    getAccountConfigStatus()
      .then(r => {
        setCfgStatus(r.data || null);
        setActiveProvider(r.data?.active_provider || null);
        setZoomActive((r.data?.zoom?.source) === 'account' && r.data?.active_provider === 'zoom');
      })
      .catch(() => { setZoomActive(false); setActiveProvider(null); });
  }, []);

  // When a board is selected, inherit its date + start/end time as the meeting's
  // default scheduled-at and duration (the user can still override below).
  useEffect(() => {
    if (!boardId) return;
    const b = boards.find(x => String(x.id) === String(boardId));
    if (!b) return;
    const { scheduledAt: schAt, duration: dur } = boardMeetingTimeDefaults(b);
    if (schAt) setScheduledAt(schAt);
    if (dur) setDuration(dur);
  }, [boardId, boards]);

  // 1 board = 1 meeting: submitting against a board that already has one updates
  // that meeting instead of adding a second, so warn before it happens.
  const existingMeeting = creatingBoard
    ? null
    : (boards.find(x => String(x.id) === String(boardId))?.primaryMeeting || null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      let bId = boardId;
      if (creatingBoard) {
        if (!newBoardTitle.trim()) {
          setErr('Board title is required');
          setSubmitting(false);
          return;
        }
        const r = await createAdvisoryBoard({ title: newBoardTitle.trim() });
        bId = String(r.data.id);
      }
      if (!bId) {
        setErr('Pick a board or create one');
        setSubmitting(false);
        return;
      }
      const payload = {
        title: title.trim() || 'Untitled meeting',
        agenda_summary: agenda.trim() || null,
        scheduled_at: scheduledAt || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        duration_minutes: Number(duration) || 60,
        format,
        join_url: joinUrl.trim() || null,
        auto_provision_zoom: autoZoom && zoomActive,
      };
      const r = await createMeeting(bId, payload);
      onCreated(r.data?.id);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Failed to create meeting');
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{
        maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border-light)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>New Meeting</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ConfigHint status={cfgStatus} />
          {/* Board picker */}
          <div>
            <label style={labelStyle}>Advisory Board</label>
            {boardsLoading ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Loading boards…</div>
            ) : creatingBoard ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newBoardTitle} onChange={e => setNewBoardTitle(e.target.value)} placeholder="New board title" style={inputStyle} autoFocus />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCreatingBoard(false)}>Cancel</button>
              </div>
            ) : boards.length === 0 ? (
              <div>
                <div style={{ fontSize: '0.83rem', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                  No advisory boards on the backend yet.
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreatingBoard(true)}>
                  <Plus size={12} /> Create a board
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={boardId} onChange={e => setBoardId(e.target.value)} style={inputStyle}>
                  {boards.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCreatingBoard(true)}>
                  + New board
                </button>
              </div>
            )}
            {existingMeeting && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-bg)', borderRadius: 6, fontSize: '0.79rem', color: 'var(--color-warning-text)' }}>
                This board already has a meeting{existingMeeting.scheduled_at
                  ? ` on ${new Date(existingMeeting.scheduled_at).toLocaleString()}`
                  : ''}. A board has one meeting, so saving <strong>updates that one</strong> instead
                of adding a second — its participants, documents and surveys stay attached.
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Meeting Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Q3 Oncology Advisory Board" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Agenda Summary <span style={hintStyle}>(one line)</span></label>
            <input value={agenda} onChange={e => setAgenda(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
            <div>
              <label style={labelStyle}>Scheduled At</label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Minutes</label>
              <input type="number" min={15} step={15} value={duration} onChange={e => setDuration(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={format} onChange={e => setFormat(e.target.value)} style={inputStyle}>
                <option value="virtual">Virtual</option>
                <option value="in_person">In-person</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            {/* A LiveKit meeting has no external URL — the room is created by
                this app when people join. */}
            {activeProvider !== 'livekit' && (
              <div>
                <label style={labelStyle}>Zoom join URL <span style={hintStyle}>(optional)</span></label>
                <input value={joinUrl} onChange={e => setJoinUrl(e.target.value)} placeholder="https://zoom.us/j/…" style={inputStyle} disabled={autoZoom && zoomActive} />
              </div>
            )}
          </div>

          {activeProvider === 'livekit' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, background: '#FFF1EF', border: '1px solid #FFD5CE', borderRadius: 6, fontSize: '0.85rem' }}>
              <span>
                <strong>This meeting runs on LiveKit.</strong>{' '}
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Nothing to set up — the room opens inside this app, with video, screen
                  share and recording included.
                </span>
              </span>
            </div>
          )}

          {zoomActive && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, background: 'var(--color-info-bg)', borderRadius: 6, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={autoZoom} onChange={e => setAutoZoom(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <strong>Auto-create the Zoom meeting.</strong>{' '}
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Generates a Zoom session with cloud recording enabled and stores the join URL automatically.
                </span>
              </span>
            </label>
          )}

          {err && (
            <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error-text)', padding: 10, borderRadius: 6, fontSize: '0.83rem' }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary"
              disabled={submitting || !isPlatformConfigured(cfgStatus)}
              title={!isPlatformConfigured(cfgStatus) ? 'Configure a meeting platform (Zoom/Teams) in Account → Meeting Platforms first' : undefined}>
              {submitting ? 'Saving…' : (existingMeeting ? 'Update Meeting' : 'Create Meeting')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: '0.9rem', boxSizing: 'border-box', background: 'white' };
const hintStyle = { fontWeight: 400, textTransform: 'none', color: 'var(--color-text-light)', letterSpacing: 0 };

// True when the account has its OWN meeting platform (Zoom/Teams) configured — a
// hard requirement to create a meeting (the platform default is not auto-used).
// Can this account actually hold a meeting? Zoom/Teams need the account's own
// credentials, but LiveKit is built into the platform — source 'platform' is a
// working setup there, not a missing one.
export function isPlatformConfigured(status) {
  if (!status) return false;
  return status.zoom?.source === 'account'
      || status.teams?.source === 'account'
      || status.livekit?.source === 'account'
      || status.livekit?.source === 'platform';
}

// Shows inside the create-meeting modals: a meeting platform is REQUIRED (blocks
// creation); SMTP missing is only a soft warning (platform default still sends).
export function ConfigHint({ status }) {
  if (!status) return null;
  const platformMissing = !isPlatformConfigured(status);
  const smtpMissing = status.smtp?.source !== 'account';
  if (!platformMissing && !smtpMissing) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
      background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', borderRadius: 8,
      fontSize: '0.82rem', color: 'var(--color-warning-text)',
    }}>
      {platformMissing && (
        <span>
          ⚠️ <strong>Configure a meeting platform (Zoom/Teams)</strong> in{' '}
          <a href="/account#meeting-platforms" style={{ color: 'var(--color-warning-text)', fontWeight: 600 }}>Account → Meeting Platforms</a>{' '}
          before creating a meeting.
        </span>
      )}
      {smtpMissing && (
        <span>
          Your emails will use the platform default until you set up{' '}
          <a href="/account#email-smtp" style={{ color: 'var(--color-warning-text)', fontWeight: 600 }}>your own SMTP</a>.
        </span>
      )}
    </div>
  );
}
