import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ArrowLeft, Edit3, Save, X, CheckCircle2, Circle, Trash2, Search, Plus,
  Users, Calendar, MapPin, Building2, Target, Briefcase, Receipt, Layers,
  Video, Clock, ArrowRight, Lock, ChevronRight, ChevronDown,
  UserCheck, Link2, Copy, RefreshCw, MessageSquare, Send, Loader, Unlock,
  Activity, FileText, Mic, ClipboardList, BookOpen, UserPlus, History, Mail, CheckCircle, AlertCircle, BarChart3,
} from 'lucide-react';
import {
  PHASES, PHASE_BY_ID, BOARD_STATUSES, BOARD_STATUS_BY_ID,
  SERVICES, SERVICE_BY_ID, FEE_UNITS,
  updateBoard, deleteBoard,
  priceForService, estimateBoardCost, formatMoney, toList,
  boardMeetingTimeDefaults,
} from './data';
import {
  getMasterData, listBoardMeetings, createMeeting, getAccountConfigStatus, getPrimaryMeeting,
  listBoardClients, createBoardClient, deleteBoardClient, regenerateClientToken, sendClientInvite, setClientPassword,
  listBoardApprovals, getBoardStatus,
  listBoardTeam, assignBoardTeamMember, removeBoardTeamMember, listBoardActivity,
  sendBoardEmail, listBoardEmails, listHCPs, listBoardKols, createBoardKol,
  listMeetingParticipants, inviteMeetingParticipants, removeMeetingParticipant,
} from '../../services/api';
import { errorMessage } from '../../utils/apiError';
import { MasterCombobox } from './BoardsTab';
// Same fields as the Advisory Boards → KOLs form, from the same source.
import { TIERS, EMPTY_KOL } from './KolsTab';   // `Field` is already defined below
import { ConfigHint, isPlatformConfigured } from './MeetingsTab';
import { MeetingWorkspace, ParticipantsSection } from './MeetingDetail';

const FORMATS = [
  { id: 'in_person', label: 'In-Person' },
  { id: 'virtual',   label: 'Virtual' },
  { id: 'hybrid',    label: 'Hybrid' },
];

const unitLabel = (unit) => FEE_UNITS.find(u => u.id === unit)?.label || unit;

// Phases temporarily hidden from the board Services view (filter chips + grouped
// list). Remove ids from here to bring a phase back.
const HIDDEN_SERVICE_PHASES = ['ongoing_support', 'event_specific'];
const VISIBLE_SERVICE_PHASES = PHASES.filter(p => !HIDDEN_SERVICE_PHASES.includes(p.id));

// Twelve sections in one wrapping tab strip read as a wall. Grouped into a
// rail they read as four short lists, and the group name tells you which one
// you want before you read the items.
const SECTION_GROUPS = [
  {
    label: 'Engagement',
    items: [
      { id: 'overview',   label: 'Overview',   icon: Layers },
      { id: 'workspace',  label: 'Documents',  icon: FileText },
      { id: 'meetings',   label: 'Meeting',    icon: Calendar },
      // The engagement dashboard lived four clicks deep, behind a section
      // labelled "Documents" — reachable only by knowing the phase strip had a
      // fourth tab. It gets its own rail entry.
      { id: 'engagement', label: 'Engagement', icon: BarChart3 },
    ],
  },
  {
    label: 'People',
    items: [
      // One list per kind of person. "Participants" and "KOLs" were two tabs for
      // the same experts (meeting invites vs. board panel); a KOL IS the
      // participant now, and clients have their own tab.
      { id: 'kols',   label: 'KOLs',    icon: UserCheck, count: (b) => (b.kolIds || []).length },
      { id: 'client', label: 'Clients', icon: Link2 },
      { id: 'team',   label: 'Team',    icon: UserPlus },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { id: 'services', label: 'Services',     icon: Briefcase, count: (b) => (b.serviceIds || []).length },
      { id: 'cost',     label: 'Cost Summary', icon: Receipt },
    ],
  },
  {
    label: 'Governance',
    items: [
      { id: 'status',   label: 'Status',        icon: Activity },
      { id: 'comms',    label: 'Communication', icon: Mail },
      { id: 'activity', label: 'Audit Trail',   icon: History },
    ],
  },
];

export default function BoardDetail({ board: initialBoard, onBack, onChange, initialSection, onSectionChange }) {
  const [board, setBoard] = useState(initialBoard);
  // Seeded from the URL (#boards/{id}/{section}) so a refresh stays put.
  const [section, setSection] = useState(initialSection || 'overview');
  // Whether the section rail still has content below the fold, so the fade and
  // the cue can drop away once you have reached the end of the list.
  const [railMore, setRailMore] = useState(false);
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialBoard);
  const [kolDir, setKolDir] = useState([]);
  const [serviceQuery, setServiceQuery] = useState('');
  const [servicePhase, setServicePhase] = useState('all');
  const [kolQuery, setKolQuery] = useState('');
  const [masters, setMasters] = useState({ pharma_sponsor: [], therapeutic_area: [], region: [], currency: [] });
  const handleCreatedMaster = (type, item) =>
    setMasters((prev) => ({ ...prev, [type]: [...(prev[type] || []), item] }));

  // Keep the URL on the section being read, and follow the URL when it changes
  // under us (Back/Forward, or a pasted link).
  useEffect(() => { onSectionChange?.(section); }, [section, onSectionChange]);
  useEffect(() => {
    if (initialSection && initialSection !== section) setSection(initialSection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection]);

  // A board's panel is drawn from BOTH directories: the advisory-board module's
  // own KOL list (Advisory Boards → KOLs) and the KOL module's HCP profiles.
  // Each entry carries a tagged id ("own:5" / "hcp:31") because a bare number
  // is ambiguous once two sources are in play — that tag is what the backend
  // stores in advisory_boards.kol_ids.
  const loadKolDir = useCallback(async () => {
    const [own, hcp] = await Promise.allSettled([
      listBoardKols({ is_active: true }), listHCPs({ limit: 1000 }),
    ]);
    const rows = [];
    if (own.status === 'fulfilled') {
      for (const k of own.value.data || []) {
        rows.push({
          id: `own:${k.id}`, name: k.name, specialty: k.specialty,
          affiliation: k.affiliation, country: k.country, email: k.email,
          source: 'own', sourceLabel: 'Adboard KOL',
        });
      }
    }
    if (hcp.status === 'fulfilled') {
      for (const h of hcp.value.data?.items || []) {
        rows.push({
          id: `hcp:${h.id}`, name: h.full_name, specialty: h.specialty,
          affiliation: h.institution, country: h.country, email: h.email,
          source: 'hcp', sourceLabel: 'KOL profile', profilePath: `/hcp/${h.id}`,
        });
      }
    }
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setKolDir(rows);
  }, []);
  useEffect(() => { loadKolDir(); }, [loadKolDir]);
  useEffect(() => { setBoard(initialBoard); setDraft(initialBoard); }, [initialBoard]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getMasterData('pharma_sponsor'),
      getMasterData('therapeutic_area'),
      getMasterData('region'),
      getMasterData('currency'),
    ]).then(([sp, ta, rg, cu]) => {
      if (cancelled) return;
      setMasters({
        pharma_sponsor:   sp.data || [],
        therapeutic_area: ta.data || [],
        region:           rg.data || [],
        currency:         cu.data || [],
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const persist = async (patch) => {
    try {
      const updated = await updateBoard(board.id, patch);
      if (updated) {
        setBoard(updated);
        setDraft(updated);
        onChange?.();
      }
      return true;
    } catch (e) {
      alert(errorMessage(e, 'Failed to save board'));
      return false;
    }
  };

  const saveEdit = async () => {
    await persist({
      title: draft.title, client: draft.client, sponsor: draft.sponsor,
      therapeuticArea: draft.therapeuticArea, region: draft.region, currency: draft.currency,
      status: draft.status, scheduledDate: draft.scheduledDate,
      startTime: draft.startTime || null, endTime: draft.endTime || null,
      format: draft.format,
      venue: draft.venue, objective: draft.objective, notes: draft.notes,
    });
    setEditing(false);
  };

  const cancelEdit = () => { setDraft(board); setEditing(false); };

  const remove = async () => {
    if (!window.confirm(`Delete advisory board "${board.title}"? This cannot be undone.`)) return;
    try {
      await deleteBoard(board.id);
      onChange?.();
      onBack();
    } catch (e) {
      alert(e.response?.data?.detail || e.message || 'Failed to delete board');
    }
  };

  const toggleService = (svcId) => {
    const set = new Set(board.serviceIds || []);
    if (set.has(svcId)) set.delete(svcId); else set.add(svcId);
    persist({ serviceIds: Array.from(set) });
  };

  const cost = useMemo(() => estimateBoardCost(board), [board]);
  const status = BOARD_STATUS_BY_ID[board.status] || BOARD_STATUSES[0];
  const currentPhaseIdx = PHASES.findIndex(p => p.id === board.currentPhase);
  const phase = PHASE_BY_ID[board.currentPhase];

  // Workflow gate: each phase's services are editable only while that phase
  // is the active one. Once we move past it, those services lock to view-only.
  // Whole-board edit/delete is allowed only while still in pre_meeting (i.e.
  // before any meeting on the board has gone live).
  const canEditPhase = (phaseId) => phaseId === board.currentPhase;
  const canEditBoard = board.currentPhase === 'pre_meeting';

  const filteredServices = SERVICES.filter(s => {
    if (servicePhase !== 'all' && s.phase !== servicePhase) return false;
    if (!serviceQuery.trim()) return true;
    const q = serviceQuery.trim().toLowerCase();
    return s.name.toLowerCase().includes(q) || s.feeLabel.toLowerCase().includes(q);
  });

  const filteredKols = kolDir.filter(k => {
    if (!kolQuery.trim()) return true;
    const q = kolQuery.trim().toLowerCase();
    return [k.name, k.specialty, k.affiliation, k.country].some(v => (v || '').toLowerCase().includes(q));
  });

  const assignedKols = (board.kolIds || []).map(id => kolDir.find(k => k.id === id)).filter(Boolean);

  const meeting = board.primaryMeeting;

  // The same readiness checks the boards list shows as chips, spelled out here
  // with what to do about each one.
  const readiness = [
    { ok: !!board.scheduledDate,                 label: 'Date confirmed',     hint: 'Add a date so the board lands on the calendar.', go: () => setEditing(true) },
    { ok: !!(board.objective || '').trim(),      label: 'Objective captured', hint: 'State what this board is meant to settle.',      go: () => setEditing(true) },
    { ok: (board.kolIds || []).length > 0,       label: 'KOLs assigned',      hint: 'Pick the experts from the directory.',           go: () => setSection('kols') },
    { ok: (board.serviceIds || []).length > 0,   label: 'Services selected',  hint: 'Choose the deliverables for each phase.',        go: () => setSection('services') },
    { ok: !!meeting,                             label: 'Meeting created',    hint: 'A meeting unlocks the workspace and agenda.',    go: () => setShowCreateMeeting(true) },
  ];
  const ready = readiness.filter(r => r.ok).length;

  return (
    <div className="board-detail">
      <div className="bd-back">
        <button className="btn btn-sm btn-ghost" onClick={onBack}><ArrowLeft size={14} /> All boards</button>
        <ChevronRight size={13} className="bd-back-sep" aria-hidden="true" />
        <span className="bd-back-current">{board.title}</span>
      </div>

      {showCreateMeeting && (
        <CreateBoardMeetingModal
          boardId={board.id}
          board={board}
          onClose={() => setShowCreateMeeting(false)}
          onCreated={(newId) => {
            setShowCreateMeeting(false);
            if (newId) window.location.hash = `#meetings/${newId}`;
          }}
        />
      )}

      {/* ── Hero: identity, actions, lifecycle ─────────────────────── */}
      <div className="card bd-hero">
        {!editing ? (
          <>
            <div className="bd-hero-top">
              <div className="bd-identity">
                <div className="bd-title-row">
                  <h2 className="bd-title">{board.title}</h2>
                  <span className="bd-pill" style={{ background: `${status.color}1A`, color: status.color }}>{status.label}</span>
                  {phase && (
                    <span className="bd-pill" style={{ background: `${phase.color}1A`, color: phase.color }}>{phase.label}</span>
                  )}
                </div>
                <div className="bd-meta">
                  {board.client && <span><Building2 size={12} /> {board.client}</span>}
                  {board.scheduledDate && <span><Calendar size={12} /> {new Date(board.scheduledDate).toLocaleDateString()}</span>}
                  {(board.startTime || board.endTime) && <span><Clock size={12} /> {[board.startTime, board.endTime].filter(Boolean).join(' – ')}</span>}
                  {toList(board.region).length > 0 && <span><MapPin size={12} /> {toList(board.region).join(', ')}</span>}
                  {toList(board.therapeuticArea).length > 0 && <span><Target size={12} /> {toList(board.therapeuticArea).join(', ')}</span>}
                  <span><Briefcase size={12} /> {FORMATS.find(f => f.id === board.format)?.label || board.format}</span>
                </div>
              </div>
              <div className="bd-actions">
                <button className="btn btn-sm btn-primary" onClick={() => setShowCreateMeeting(true)}>
                  <Video size={13} /> Create Meeting
                </button>
                {canEditBoard ? (
                  <>
                    <button className="btn btn-sm btn-outline" onClick={() => setEditing(true)}><Edit3 size={13} /> Edit</button>
                    <button className="btn btn-sm btn-ghost" onClick={remove} style={{ color: 'var(--color-error)' }}><Trash2 size={13} /></button>
                  </>
                ) : (
                  <span className="bd-locked" title="Locked once the board moves past Pre-Meeting">
                    <Lock size={12} /> Locked
                  </span>
                )}
              </div>
            </div>

            {/* Four numbers that answer "where is this board at" without a click. */}
            <div className="bd-stats">
              <button type="button" className="bd-stat" onClick={() => setSection('kols')}>
                <span className="bd-stat-label"><Users size={12} /> KOLs</span>
                <span className="bd-stat-value">{(board.kolIds || []).length}</span>
              </button>
              <button type="button" className="bd-stat" onClick={() => setSection('services')}>
                <span className="bd-stat-label"><Briefcase size={12} /> Services</span>
                <span className="bd-stat-value">{(board.serviceIds || []).length}</span>
              </button>
              <button type="button" className="bd-stat" onClick={() => setSection('cost')}>
                <span className="bd-stat-label"><Receipt size={12} /> Estimate</span>
                <span className="bd-stat-value">{formatMoney(cost.total, cost.currency || board.currency)}</span>
              </button>
              <button type="button" className="bd-stat" onClick={() => setSection(meeting ? 'meetings' : 'overview')}>
                <span className="bd-stat-label"><Video size={12} /> Meeting</span>
                <span className="bd-stat-value bd-stat-text">{meeting ? (meeting.status || 'scheduled') : 'None yet'}</span>
              </button>
              <button type="button" className="bd-stat" onClick={() => setSection('overview')}>
                <span className="bd-stat-label"><CheckCircle2 size={12} /> Readiness</span>
                <span className="bd-stat-value">{ready}<span className="bd-stat-of">/{readiness.length}</span></span>
              </button>
            </div>
          </>
        ) : (
          <EditForm draft={draft} setDraft={setDraft} onSave={saveEdit} onCancel={cancelEdit}
            masters={masters} onCreatedMaster={handleCreatedMaster} />
        )}

        {/* Lifecycle. Same track as the boards list, with step labels the
            list has no room for, and each step opens that phase's services. */}
        <div className="bd-phases">
          <div className="bd-phases-head">
            <span className="bd-eyebrow">Engagement phase</span>
            <span className="bd-phases-note">
              Pre → Meeting → Post advances automatically with meeting start/end. Tap a phase to see its services.
            </span>
          </div>
          <div className="bd-phase-row">
            {PHASES.map((p, idx) => {
              const isCurrent = p.id === board.currentPhase;
              const isPast = idx < currentPhaseIdx;
              return (
                <button key={p.id}
                  className={`bd-phase${isCurrent ? ' is-current' : ''}${isPast ? ' is-done' : ''}`}
                  onClick={() => { setSection('services'); setServicePhase(p.id); }}
                  title={`View ${p.label} services`}
                  style={isCurrent ? { '--phase-color': p.color } : undefined}>
                  <span className="bd-phase-bar" style={{ background: isCurrent || isPast ? p.color : undefined }} />
                  <span className="bd-phase-step">Step {idx + 1}</span>
                  <span className="bd-phase-label" style={isCurrent ? { color: p.color } : undefined}>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Body: section rail + panel ─────────────────────────────── */}
      <div className="bd-body">
        {/* Wrapper carries the sticky position and the bottom fade — a fade
            drawn on the scroller itself would scroll away with the content. */}
        <div className={`bd-rail-wrap${railMore ? ' has-more' : ''}`}>
        <nav
          className="bd-rail"
          aria-label="Board sections"
          ref={(el) => {
            if (!el) return;
            const more = el.scrollHeight - el.clientHeight - el.scrollTop > 4;
            if (more !== railMore) setRailMore(more);
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            setRailMore(el.scrollHeight - el.clientHeight - el.scrollTop > 4);
          }}
        >
          {SECTION_GROUPS.map(group => (
            <div className="bd-rail-group" key={group.label}>
              <div className="bd-rail-heading">{group.label}</div>
              {group.items.map(item => {
                const Icon = item.icon;
                const count = item.count ? item.count(board) : null;
                return (
                  <button key={item.id} type="button"
                    className={`bd-rail-link${section === item.id ? ' is-active' : ''}`}
                    onClick={() => setSection(item.id)}>
                    <Icon size={15} />
                    <span className="bd-rail-label">{item.label}</span>
                    {count !== null && <span className="bd-rail-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <span className="bd-rail-more" aria-hidden="true"><ChevronDown size={14} /> more</span>
        </div>

        <div className="bd-panel">
      {section === 'overview' && (
        <div className="bd-overview">
          <div className="bd-col">
          <div className="card bd-brief">
            <div className="bd-eyebrow">Objective</div>
            {board.objective ? (
              <p className="bd-prose">{board.objective}</p>
            ) : (
              <p className="bd-empty">
                No objective captured yet.{' '}
                {canEditBoard && <button className="btn-link" onClick={() => setEditing(true)}>Add one</button>}
              </p>
            )}

            <div className="bd-facts">
              <div className="bd-fact">
                <span className="bd-eyebrow">Venue / Platform</span>
                <span>{board.venue || <em className="bd-empty">Not set</em>}</span>
              </div>
              <div className="bd-fact">
                <span className="bd-eyebrow">Sponsor</span>
                <span>{board.sponsor || <em className="bd-empty">Not set</em>}</span>
              </div>
              <div className="bd-fact">
                <span className="bd-eyebrow">Format</span>
                <span>{FORMATS.find(f => f.id === board.format)?.label || board.format}</span>
              </div>
              <div className="bd-fact">
                <span className="bd-eyebrow">Currency</span>
                <span>{board.currency || 'USD'}</span>
              </div>
            </div>

            {board.notes && (
              <div className="bd-notes">
                <div className="bd-eyebrow">Internal notes</div>
                <p className="bd-prose bd-prose-pre">{board.notes}</p>
              </div>
            )}
          </div>

          {/* What was actually bought, per phase — the Overview's job is to
              summarise the board, and "10 services" alone does not. */}
          <div className="card bd-breakdown">
            <div className="bd-readiness-head">
              <span className="bd-eyebrow">Services by phase</span>
              <span className="bd-readiness-score">{(board.serviceIds || []).length}</span>
            </div>
            {(board.serviceIds || []).length === 0 ? (
              <p className="bd-empty" style={{ margin: '10px 0 0' }}>
                Nothing selected yet.{' '}
                <button className="btn-link" onClick={() => setSection('services')}>Pick services</button>
              </p>
            ) : (
              <div className="bd-phase-counts">
                {VISIBLE_SERVICE_PHASES.map(ph => {
                  const n = (board.serviceIds || []).filter(id => SERVICE_BY_ID[id]?.phase === ph.id).length;
                  const pct = Math.round((n / Math.max(1, (board.serviceIds || []).length)) * 100);
                  return (
                    <button key={ph.id} type="button" className="bd-phase-count"
                      onClick={() => { setSection('services'); setServicePhase(ph.id); }}
                      title={`View ${ph.label} services`}>
                      <span className="bd-phase-count-label">{ph.label}</span>
                      <span className="bd-phase-count-track">
                        <span className="bd-phase-count-fill" style={{ width: `${pct}%`, background: ph.color }} />
                      </span>
                      <span className="bd-phase-count-n">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* KOL roster preview — saves a click when you just want the names. */}
          <div className="card bd-roster">
            <div className="bd-readiness-head">
              <span className="bd-eyebrow">Advisors</span>
              <span className="bd-readiness-score">{assignedKols.length}</span>
            </div>
            {assignedKols.length === 0 ? (
              <p className="bd-empty" style={{ margin: '10px 0 0' }}>
                No KOLs assigned yet.{' '}
                <button className="btn-link" onClick={() => setSection('kols')}>Choose advisors</button>
              </p>
            ) : (
              <ul className="bd-roster-list">
                {assignedKols.slice(0, 6).map(k => (
                  <li key={k.id} className="bd-roster-item">
                    <span className="bd-roster-avatar">{(k.name || '?').trim().charAt(0).toUpperCase()}</span>
                    <span className="bd-roster-body">
                      <span className="bd-roster-name">{k.name}</span>
                      <span className="bd-roster-sub">{[k.specialty, k.country].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                ))}
                {assignedKols.length > 6 && (
                  <li className="bd-roster-more">
                    <button className="btn-link" onClick={() => setSection('kols')}>
                      +{assignedKols.length - 6} more
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
          </div>

          {/* The right column used to be empty. It now carries the thing a
              user actually wants on opening a board: what is still missing. */}
          <div className="card bd-readiness">
            <div className="bd-readiness-head">
              <span className="bd-eyebrow">Readiness</span>
              <span className="bd-readiness-score">{ready}/{readiness.length}</span>
            </div>
            <div className="bd-readiness-track">
              <span className="bd-readiness-fill" style={{ width: `${(ready / readiness.length) * 100}%` }} />
            </div>
            <ul className="bd-checks">
              {readiness.map(r => (
                <li key={r.label} className={`bd-check${r.ok ? ' is-ok' : ''}`}>
                  {r.ok ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                  <div>
                    <button type="button" className="bd-check-label" onClick={r.go}>{r.label}</button>
                    {!r.ok && <div className="bd-check-hint">{r.hint}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {section === 'workspace' && (
        <BoardWorkspaceSection boardId={board.id} />
      )}

      {section === 'engagement' && (
        <BoardWorkspaceSection boardId={board.id} initialPhase="engagement" />
      )}

      {section === 'meetings' && (
        <BoardMeetingsSection boardId={board.id} boardTitle={board.title} />
      )}

      {section === 'team' && (
        <BoardTeamSection boardId={board.id} />
      )}

      {section === 'status' && (
        <BoardStatusSection boardId={board.id} />
      )}

      {section === 'client' && (
        <BoardClientsSection boardId={board.id} boardClientName={board.client} />
      )}

      {section === 'comms' && (
        <BoardCommsSection boardId={board.id} />
      )}

      {section === 'activity' && (
        <BoardActivitySection boardId={board.id} />
      )}

      {section === 'kols' && (
        <BoardKolsSection board={board} kolDir={kolDir} filteredKols={filteredKols}
          kolQuery={kolQuery} setKolQuery={setKolQuery} persist={persist}
          reloadKolDir={loadKolDir} />
      )}

      {section === 'services' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ margin: 0 }}>Services ({(board.serviceIds || []).length})</h4>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                Each phase unlocks while the board is in that phase. Other phases are read-only.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Estimated:</span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)' }}>{formatMoney(cost.total, cost.currency)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <FilterPill active={servicePhase === 'all'} onClick={() => setServicePhase('all')} label="All phases" color="var(--color-text-secondary)" />
            {VISIBLE_SERVICE_PHASES.map(p => <FilterPill key={p.id} active={servicePhase === p.id} onClick={() => setServicePhase(p.id)} label={p.short} color={p.color} />)}
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
              <input className="form-control" placeholder="Search services…" value={serviceQuery} onChange={e => setServiceQuery(e.target.value)} style={{ paddingLeft: 32 }} />
            </div>
          </div>

          {/* Group by phase so the lock state is visually obvious. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {VISIBLE_SERVICE_PHASES.filter(p => servicePhase === 'all' || servicePhase === p.id).map(phase => {
              const phaseServices = filteredServices.filter(s => s.phase === phase.id);
              if (phaseServices.length === 0) return null;
              const phaseSelected = phaseServices.filter(s => (board.serviceIds || []).includes(s.id)).length;
              const editable = canEditPhase(phase.id);
              return (
                <div key={phase.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                    padding: '8px 12px', borderLeft: `3px solid ${phase.color}`,
                    background: editable ? `${phase.color}10` : 'var(--color-bg)',
                    borderRadius: 4,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text)' }}>
                        {phase.label}
                        <span style={{
                          marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                          background: editable ? phase.color : 'var(--color-text-light)', color: 'var(--color-text-inverse)',
                        }}>
                          {editable ? 'Editable' : 'Locked'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                        {phaseSelected} of {phaseServices.length} selected
                        {!editable && phase.id !== board.currentPhase && (
                          <> · only changeable while the board is in <strong>{phase.label}</strong></>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                    {phaseServices.map(svc => (
                      <ServiceCard key={svc.id} svc={svc}
                        selected={(board.serviceIds || []).includes(svc.id)}
                        locked={!editable}
                        onToggle={toggleService} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'cost' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg-muted, var(--color-bg))' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cost Estimate</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-primary)', marginTop: 4 }}>
              {formatMoney(cost.total, cost.currency)}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: 2 }}>
              Based on {(board.kolIds || []).length} KOL(s), 1 day, 1 region. Override per-board overrides will be supported when backend is wired up.
            </div>
          </div>
          {cost.lines.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              No services selected yet. Go to the Services section to pick deliverables.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-light)' }}>
                  <Th>Service</Th><Th>Phase</Th><Th align="right">Unit price</Th><Th align="right">Qty</Th><Th align="right">Line total</Th>
                </tr>
              </thead>
              <tbody>
                {cost.lines.map(line => (
                  <tr key={line.service.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{line.service.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>{line.service.feeLabel}</div>
                    </Td>
                    <Td>
                      <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: 4, background: `${PHASE_BY_ID[line.service.phase].color}1A`, color: PHASE_BY_ID[line.service.phase].color, fontWeight: 600 }}>
                        {PHASE_BY_ID[line.service.phase].short}
                      </span>
                    </Td>
                    <Td align="right">{line.unitPrice > 0 ? formatMoney(line.unitPrice, line.currency) : <span style={{ color: 'var(--color-text-light)' }}>not set</span>}<br /><span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>/ {unitLabel(line.unit)}</span></Td>
                    <Td align="right">{line.qty}</Td>
                    <Td align="right" style={{ fontWeight: 600 }}>{formatMoney(line.lineTotal, line.currency)}</Td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--color-bg-muted, var(--color-bg))' }}>
                  <Td><strong>Total</strong></Td><Td /><Td /><Td /><Td align="right"><strong style={{ color: 'var(--color-primary)' }}>{formatMoney(cost.total, cost.currency)}</strong></Td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

// ── Team section (assign medical writer / project manager — gates access) ────

const TEAM_ROLES = [
  { id: 'project_manager', label: 'Project Manager' },
  { id: 'medical_writer', label: 'Medical Writer' },
  { id: 'reviewer', label: 'Reviewer' },
];
const teamRoleLabel = (id) => TEAM_ROLES.find(r => r.id === id)?.label || id;

function BoardTeamSection({ boardId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ email: '', role: 'medical_writer' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await listBoardTeam(boardId); setMembers(r.data); }
    catch { setErr('Failed to load team.'); }
    finally { setLoading(false); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.email.trim()) { setErr('Enter the user’s registered email.'); return; }
    setSaving(true); setErr('');
    try {
      await assignBoardTeamMember(boardId, { email: form.email.trim(), role: form.role });
      setForm({ email: '', role: 'medical_writer' });
      await load();
    } catch (e) { setErr(e.response?.data?.detail || 'Could not assign member.'); }
    finally { setSaving(false); }
  };

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name || m.email} from the team? They’ll lose access to this board.`)) return;
    try { await removeBoardTeamMember(boardId, m.id); await load(); } catch { setErr('Could not remove member.'); }
  };

  if (loading) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  return (
    <div className="card" style={{ padding: 18 }}>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>Assigned Team</h3>
      <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
        Assigned medical writers / project managers can access and manage this board. (Platform admins and the board creator always have access.)
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, marginBottom: 16, alignItems: 'end' }}>
        <input className="form-control" placeholder="User’s registered email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <select className="form-control" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
          {TEAM_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={add} disabled={saving}>{saving ? <Loader size={15} className="spinning" /> : <><Plus size={14} /> Assign</>}</button>
      </div>

      {members.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '0.88rem' }}>No team members assigned yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{m.name || m.email}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>{m.email}{m.organization ? ` · ${m.organization}` : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: 'var(--color-violet-bg)', color: 'var(--color-violet)' }}>{teamRoleLabel(m.role)}</span>
                <button className="btn btn-sm" onClick={() => remove(m)} title="Remove" style={{ ...ghostBtn, color: 'var(--color-error)' }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Communication section (email invitations / reminders / notifications) ────

const EMAIL_ACTIONS = [
  { type: 'kol_invite',     label: 'Invite KOLs/advisors', desc: 'Email participants their portal join link.' },
  { type: 'survey_reminder', label: 'Survey reminder',      desc: 'Remind participants to complete their survey.' },
  { type: 'document_review', label: 'Document review',      desc: 'Notify participants a document needs review.' },
  { type: 'report_review',   label: 'Report review (client)', desc: 'Ask the board client to review the report.' },
];
const EMAIL_KIND_LABEL = {
  kol_invite: 'KOL invite', survey_reminder: 'Survey reminder', document_review: 'Document review',
  report_review: 'Report review', meeting_reminder_24h: 'Meeting reminder (24h)', meeting_reminder_1h: 'Meeting reminder (1h)',
};

function BoardCommsSection({ boardId }) {
  const [emails, setEmails] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [viewing, setViewing] = useState(null);   // email record being previewed

  const load = useCallback(async () => {
    try { const r = await listBoardEmails(boardId); setEmails(r.data); } catch { setEmails([]); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  const send = async (type) => {
    setBusy(type); setMsg('');
    try {
      const r = await sendBoardEmail(boardId, { type, note: note.trim() || undefined });
      setMsg(`${EMAIL_KIND_LABEL[type] || type}: ${r.data.sent} sent${r.data.failed ? `, ${r.data.failed} failed` : ''}.`);
      setNote('');
      await load();
    } catch (e) { setMsg(e.response?.data?.detail || 'Could not send email.'); }
    finally { setBusy(''); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>Send Email</h3>
        <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
          Each recipient gets a personalised secure link. Delivery status is tracked below.
        </p>
        <textarea className="form-control" rows={2} placeholder="Optional note to include in the email…"
          value={note} onChange={e => setNote(e.target.value)} style={{ resize: 'vertical', marginBottom: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {EMAIL_ACTIONS.map(a => (
            <button key={a.type} className="btn" onClick={() => send(a.type)} disabled={!!busy}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, textAlign: 'left',
                border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', background: 'var(--color-surface)', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.88rem' }}>
                {busy === a.type ? <Loader size={14} className="spinning" /> : <Mail size={14} style={{ color: 'var(--color-primary)' }} />} {a.label}
              </span>
              <span style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>{a.desc}</span>
            </button>
          ))}
        </div>

        {/* Whether a document is public is decided in ONE place — the share-link
            action on the documents panel. This email only reflects that state,
            so there is no second control here that could contradict it. */}
        <p style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 12, marginBottom: 0,
          padding: '9px 11px', background: 'var(--color-bg-secondary, var(--color-bg))',
          border: '1px solid var(--color-border-light)', borderRadius: 8,
          fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          <Link2 size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            <strong style={{ color: 'var(--color-text-secondary)' }}>Document review email:</strong> documents you’ve
            shared with the link button in <strong>Documents</strong> are included as direct links. The rest are
            named in the email and open through each recipient’s own portal, where access stays permission-gated.
          </span>
        </p>

        {msg && <div style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{msg}</div>}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Communication History</h3>
          <button className="btn btn-sm" onClick={load} style={ghostBtn}><RefreshCw size={13} /> Refresh</button>
        </div>
        {emails === null ? <Loader size={20} className="spinning" /> :
          emails.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '0.88rem' }}>No emails sent yet.</p> :
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {emails.map(e => (
              <button key={e.id} onClick={() => setViewing(e)} title="Open this email"
                style={{ display: 'flex', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--color-border-light)',
                  alignItems: 'flex-start', background: 'transparent', border: 'none', borderBottomColor: 'var(--color-border-light)',
                  textAlign: 'left', cursor: 'pointer', width: '100%' }}
                onMouseEnter={ev => ev.currentTarget.style.background = 'var(--color-bg-secondary, var(--color-bg))'}
                onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                {e.success
                  ? <CheckCircle size={15} style={{ color: 'var(--color-success)', marginTop: 3, flexShrink: 0 }} />
                  : <AlertCircle size={15} style={{ color: 'var(--color-error)', marginTop: 3, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600 }}>{e.subject}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
                    {EMAIL_KIND_LABEL[e.kind] || e.kind} · {e.recipient_email} · {new Date(e.sent_at).toLocaleString()}
                  </div>
                  {!e.success && e.error && <div style={{ fontSize: '0.74rem', color: 'var(--color-error)' }}>{e.error}</div>}
                </div>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: e.success ? 'var(--color-success-text)' : 'var(--color-error-text)' }}>
                  {e.success ? 'Sent' : 'Failed'}
                </span>
              </button>
            ))}
          </div>}
      </div>

      {viewing && <EmailViewerModal email={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// Opens a sent email — header details + the actual rendered HTML body (sandboxed
// iframe so stored markup can't run scripts).
function EmailViewerModal({ email, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: 640, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{email.subject}</h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
              <strong>To:</strong> {email.recipient_email}
              <span style={{ margin: '0 6px' }}>·</span>
              {EMAIL_KIND_LABEL[email.kind] || email.kind}
              <span style={{ margin: '0 6px' }}>·</span>
              {new Date(email.sent_at).toLocaleString()}
              <span style={{ margin: '0 6px' }}>·</span>
              <span style={{ fontWeight: 700, color: email.success ? 'var(--color-success-text)' : 'var(--color-error-text)' }}>{email.success ? 'Sent' : 'Failed'}</span>
            </div>
            {!email.success && email.error && <div style={{ fontSize: '0.76rem', color: 'var(--color-error)', marginTop: 4 }}>{email.error}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', flexShrink: 0 }}><X size={18} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-surface-raised)', padding: 14 }}>
          {email.body_preview ? (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={email.body_preview}
              style={{ width: '100%', height: 380, border: '1px solid var(--color-border-light)', borderRadius: 8, background: 'var(--color-surface)' }}
            />
          ) : (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              No preview stored for this email.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Audit trail section ──────────────────────────────────

const ACTIVITY_LABEL = {
  'board.created': 'Board created',
  'board.updated': 'Board updated',
  'board.phase_changed': 'Stage changed',
  'client.added': 'Client added',
  'client.removed': 'Client removed',
  'team.assigned': 'Team member assigned',
  'team.removed': 'Team member removed',
  'message.posted': 'Message posted',
  'kol.login': 'KOL/advisor portal login',
  'kol.document_download': 'KOL/advisor document download',
  'email.sent': 'Email sent',
};

function BoardActivitySection({ boardId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { const r = await listBoardActivity(boardId); setRows(r.data); }
    catch { setErr('Failed to load audit trail.'); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="alert alert-error">{err}</div>;
  if (!rows) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}><History size={16} /> Audit Trail</h3>
        <button className="btn btn-sm" onClick={load} style={ghostBtn}><RefreshCw size={13} /> Refresh</button>
      </div>
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '0.88rem' }}>No activity recorded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-light)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', marginTop: 6, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{ACTIVITY_LABEL[a.action] || a.action}</div>
                {a.details && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{a.details}</div>}
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>
                  {a.performer_name || 'System'} · {new Date(a.created_at).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status section (completion monitoring for medical writers / PMs) ─────────

const TRANSCRIPT_COLORS = { draft: 'var(--color-text-light)', edited: 'var(--color-info)', shared: 'var(--color-violet)', finalized: 'var(--color-success)' };
const MINUTES_COLORS = { draft: 'var(--color-text-light)', shared: 'var(--color-violet)', finalized: 'var(--color-success)' };

function StatBox({ label, value, sub, icon: Icon }) {
  return (
    <div style={{ flex: 1, minWidth: 140, border: '1px solid var(--color-border-light)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {Icon && <Icon size={13} />} {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>{sub}</div>}
    </div>
  );
}

function byStatusText(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `${v} ${k}`).join(' · ');
}

function BoardStatusSection({ boardId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { const r = await getBoardStatus(boardId); setData(r.data); }
    catch { setErr('Failed to load status.'); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="alert alert-error">{err}</div>;
  if (!data) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  const e = data.engagements;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatBox label="Meetings" value={data.meetings.total} sub={byStatusText(data.meetings.by_status)} icon={Calendar} />
        <StatBox label="Documents" value={data.documents.total} sub={`${data.documents.client_visible} shared with client`} icon={FileText} />
        <StatBox label="Transcripts" value={`${data.transcripts.total}/${data.meetings.total}`} sub={data.transcripts.missing > 0 ? `${data.transcripts.missing} missing` : 'all present'} icon={Mic} />
        <StatBox label="Minutes" value={`${data.minutes.total}/${data.meetings.total}`} sub={data.minutes.missing > 0 ? `${data.minutes.missing} missing` : 'all present'} icon={BookOpen} />
        <StatBox label="Manuscripts" value={data.manuscripts.total} sub={byStatusText(data.manuscripts.by_status)} icon={FileText} />
      </div>

      {/* Engagements + approvals */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}><ClipboardList size={16} /> Engagement & Approvals</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatBox label="Pre surveys" value={e.pre_surveys} />
          <StatBox label="Post surveys" value={e.post_surveys} />
          <StatBox label="Survey responses" value={e.survey_responses} />
          <StatBox label="Live polls" value={e.polls} sub={`${e.poll_votes} votes`} />
          <StatBox label="Client approvals" value={data.approvals.total} sub={byStatusText(data.approvals.by_status)} />
        </div>
      </div>

      {/* Per-meeting table */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Per-meeting progress</h3>
          <button className="btn btn-sm" onClick={load} style={ghostBtn}><RefreshCw size={13} /> Refresh</button>
        </div>
        {data.per_meeting.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '0.88rem' }}>No meetings yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: '0.74rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '6px 8px' }}>Meeting</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Docs</th>
                <th style={{ padding: '6px 8px' }}>Transcript</th>
                <th style={{ padding: '6px 8px' }}>Minutes</th>
              </tr>
            </thead>
            <tbody>
              {data.per_meeting.map(m => (
                <tr key={m.id} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                  <td style={{ padding: '8px' }}>{m.title}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{m.status}</td>
                  <td style={{ padding: '8px' }}>{m.documents}</td>
                  <td style={{ padding: '8px' }}>{m.transcript_status
                    ? <span style={{ color: TRANSCRIPT_COLORS[m.transcript_status] || 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'capitalize' }}>{m.transcript_status}</span>
                    : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                  <td style={{ padding: '8px' }}>{m.minutes_status
                    ? <span style={{ color: MINUTES_COLORS[m.minutes_status] || 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'capitalize' }}>{m.minutes_status}</span>
                    : <span style={{ color: 'var(--color-border-strong)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Client section (assign clients, magic links, approvals) ─────────────────

const APPROVAL_BADGE = {
  pending: { label: 'Pending', bg: 'var(--color-surface-raised)', fg: 'var(--color-text-secondary)' },
  approved: { label: 'Approved', bg: 'var(--color-success-bg)', fg: 'var(--color-success-text)' },
  changes_requested: { label: 'Changes requested', bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-text)' },
  rejected: { label: 'Rejected', bg: 'var(--color-error-bg)', fg: 'var(--color-error-text)' },
};

function clientPortalUrl(token) {
  return `${window.location.origin}/client/${token}`;
}

function BoardClientsSection({ boardId, boardClientName }) {
  const [clients, setClients] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', organization: '' });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [c, a] = await Promise.all([listBoardClients(boardId), listBoardApprovals(boardId)]);
      setClients(c.data); setApprovals(a.data);
    } catch { setErr('Failed to load clients.'); }
    finally { setLoading(false); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  const addClient = async () => {
    if (!form.name.trim() || !form.email.trim()) { setErr('Name and email are required.'); return; }
    setSaving(true); setErr('');
    try {
      await createBoardClient(boardId, { name: form.name.trim(), email: form.email.trim(), organization: form.organization.trim() || null });
      setForm({ name: '', email: '', organization: '' }); setShowAdd(false);
      await load();
    } catch (e) { setErr(e.response?.data?.detail || 'Could not add client.'); }
    finally { setSaving(false); }
  };

  // Manual send, so the account holder can hand the portal over themselves —
  // for a client added before invites existed, a bounced address, or a link
  // that was just regenerated.
  const [sendingId, setSendingId] = useState(null);
  const sendInvite = async (c) => {
    setSendingId(c.id);
    try {
      await sendClientInvite(boardId, c.id);
      await load();
      alert(`Portal link emailed to ${c.email}.`);
    } catch (e) {
      alert(e.response?.data?.detail || 'Could not send the invite email.');
    } finally { setSendingId(null); }
  };

  // The plaintext password comes back from the server ONCE and is never
  // retrievable again, so it is held here until dismissed and the UI says so.
  const [newPassword, setNewPassword] = useState(null);   // { clientId, password }
  const [pwBusyId, setPwBusyId] = useState(null);

  const setPassword = async (c) => {
    const typed = window.prompt(
      `Portal password for ${c.name}.\n\nLeave blank to generate a strong one. ` +
      `It is shown once and cannot be retrieved later.`,
      ''
    );
    if (typed === null) return;                 // cancelled
    if (typed.trim() && typed.trim().length < 8) { alert('Password must be at least 8 characters.'); return; }
    setPwBusyId(c.id);
    try {
      const r = await setClientPassword(boardId, c.id, { password: typed.trim() || null });
      setNewPassword({ clientId: c.id, password: r.data.password });
      await load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Could not set the password.');
    } finally { setPwBusyId(null); }
  };

  const clearPassword = async (c) => {
    if (!window.confirm(`Remove the portal password for ${c.name}? Their link alone will then open the portal.`)) return;
    setPwBusyId(c.id);
    try {
      await setClientPassword(boardId, c.id, { clear: true });
      setNewPassword(null);
      await load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Could not remove the password.');
    } finally { setPwBusyId(null); }
  };

  const copyLink = async (c) => {
    try { await navigator.clipboard.writeText(clientPortalUrl(c.access_token)); setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1500); }
    catch { /* ignore */ }
  };

  const regen = async (c) => {
    if (!window.confirm('Regenerate the access link? The old link will stop working.')) return;
    try { await regenerateClientToken(boardId, c.id); await load(); } catch { setErr('Could not regenerate link.'); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove client "${c.name}"? Their access link will stop working.`)) return;
    try { await deleteBoardClient(boardId, c.id); await load(); } catch { setErr('Could not remove client.'); }
  };

  if (loading) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div className="alert alert-error">{err}</div>}

      {/* Clients */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Clients</h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: 2 }}>
              People at the client who get a portal login. Separate from the board's Client field.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(s => !s)}><Plus size={14} /> Add client</button>
        </div>

        {showAdd && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 14, alignItems: 'end' }}>
            <input className="form-control" placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="form-control" placeholder="Email *" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input className="form-control" placeholder="Organization" value={form.organization} onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} />
            <button className="btn btn-primary" onClick={addClient} disabled={saving}>{saving ? <Loader size={15} className="spinning" /> : 'Save'}</button>
          </div>
        )}

        {clients.length === 0 ? (
          <div style={{ color: 'var(--color-text-light)', fontSize: '0.88rem' }}>
            <p style={{ margin: 0 }}>No client contacts yet — nobody can open the client portal for this board.</p>
            {boardClientName && (
              // Without this the section reads as "your client vanished": the
              // board already shows a Client of this name, but that field is
              // just the account name, not a person who can log in.
              <p style={{ margin: '6px 0 0' }}>
                This board's client is <strong>{boardClientName}</strong>, but that is only the
                account name. Add the individual there — with their email — to give them a
                portal login.
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clients.map(c => (
              <div key={c.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }}>{c.email}{c.organization ? ` · ${c.organization}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => sendInvite(c)} disabled={sendingId === c.id}
                      title={c.invite_sent_at ? 'Re-send the portal link by email' : 'Email the portal link to this client'}
                      style={ghostBtn}>
                      {sendingId === c.id ? <Loader size={14} className="spinning" /> : <Send size={14} />}
                      {c.invite_sent_at ? ' Re-send' : ' Send invite'}
                    </button>
                    <button className="btn btn-sm" onClick={() => copyLink(c)} title="Copy portal link"
                      style={ghostBtn}>{copiedId === c.id ? <><CheckCircle2 size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
                    <button className="btn btn-sm" onClick={() => (c.has_password ? clearPassword(c) : setPassword(c))}
                      disabled={pwBusyId === c.id}
                      title={c.has_password ? 'Remove the portal password' : 'Set a portal password'}
                      style={ghostBtn}>
                      {pwBusyId === c.id ? <Loader size={14} className="spinning" /> : (c.has_password ? <Lock size={14} /> : <Unlock size={14} />)}
                      {c.has_password ? ' Password set' : ' Set password'}
                    </button>
                    {c.has_password && (
                      <button className="btn btn-sm" onClick={() => setPassword(c)} disabled={pwBusyId === c.id}
                        title="Replace the portal password" style={ghostBtn}><RefreshCw size={14} /> Reset</button>
                    )}
                    <button className="btn btn-sm" onClick={() => regen(c)} title="Regenerate link" style={ghostBtn}><RefreshCw size={14} /></button>
                    <button className="btn btn-sm" onClick={() => remove(c)} title="Remove client" style={{ ...ghostBtn, color: 'var(--color-error)' }}><Trash2 size={14} /></button>
                  </div>
                </div>
                {newPassword?.clientId === c.id && newPassword.password && (
                  <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 8,
                    background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)',
                  }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 700, marginBottom: 5 }}>
                      Copy this password now — it cannot be shown again.
                    </div>
                    <code style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: 1, userSelect: 'all' }}>
                      {newPassword.password}
                    </code>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-sm" style={ghostBtn}
                        onClick={() => navigator.clipboard?.writeText(newPassword.password)}>
                        <Copy size={13} /> Copy
                      </button>
                      <button className="btn btn-sm" style={ghostBtn} onClick={() => setNewPassword(null)}>Done</button>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: 7 }}>
                      Send it to the client <strong>separately from the portal link</strong> — the invite
                      email deliberately does not contain it.
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: '0.76rem' }}>
                  {c.has_password && (
                    <span style={{ color: 'var(--color-success)', marginRight: 10 }}>🔒 Password protected</span>
                  )}
                  {c.invite_sent_at ? (
                    <span style={{ color: 'var(--color-success)' }}>
                      ✓ Invite emailed {new Date(c.invite_sent_at).toLocaleString()}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-warning-text)' }}>
                      Not emailed yet — this client has a working link but has not been told about it.
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                  <Link2 size={13} />
                  <code style={{ background: 'var(--color-bg)', padding: '2px 8px', borderRadius: 5, wordBreak: 'break-all' }}>{clientPortalUrl(c.access_token)}</code>
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={{ margin: '12px 0 0', fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          Tip: in a meeting's Documents, toggle “Visible to client” to share a document for review/approval.
        </p>
      </div>

      {/* Approvals */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Document Approvals</h3>
        {approvals.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '0.88rem' }}>No client decisions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvals.map(a => {
              const b = APPROVAL_BADGE[a.status] || APPROVAL_BADGE.pending;
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', background: 'var(--color-bg)', borderRadius: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{a.document_title}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
                      {a.client_name}{a.comment ? ` · “${a.comment}”` : ''}
                    </div>
                  </div>
                  <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: b.bg, color: b.fg, whiteSpace: 'nowrap' }}>{b.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 7, padding: '5px 10px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' };

// ── Workspace section (documents, participants, surveys, polls) ──────────────
// 1 board = 1 meeting: resolve the board's single meeting and render the full
// per-meeting workspace here, so all content lives in the board workspace.

function BoardWorkspaceSection({ boardId, initialPhase = 'pre' }) {
  const [meeting, setMeeting] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { const r = await getPrimaryMeeting(boardId); setMeeting(r.data); }
    catch (e) { setErr(e.response?.data?.detail || 'Failed to load workspace.'); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="alert alert-error">{err}</div>;
  if (!meeting) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  return <MeetingWorkspace meetingId={meeting.id} zoomMeetingId={meeting.zoom_meeting_id}
                          initialPhase={initialPhase} />;
}

// ── KOLs section: the board's panel AND its meeting participants ─────────────
// A KOL on the board is a participant of the board's meeting, so selecting one
// does both: adds them to `kol_ids` (cost, overview) and invites them to the
// meeting (personal login link by email). Unselecting undoes both.
const kolKeyOf = (p) => (p.hcp_id ? `hcp:${p.hcp_id}` : p.board_kol_id ? `own:${p.board_kol_id}` : null);
const kolInvitee = (kolId) => {
  const [src, id] = String(kolId).split(':');
  // KOLs speak in the meeting — and only people who can speak are recorded.
  return src === 'own'
    ? { board_kol_id: Number(id), role: 'panel_member' }
    : { hcp_id: Number(id), role: 'panel_member' };
};

function BoardKolsSection({ board, kolDir, filteredKols, kolQuery, setKolQuery, persist, reloadKolDir }) {
  const [meeting, setMeeting] = useState(null);
  const [parts, setParts] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKol, setNewKol] = useState(EMPTY_KOL);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPrimaryMeeting(board.id)
      .then(r => { if (!cancelled) setMeeting(r.data); })
      .catch(e => { if (!cancelled) setErr(errorMessage(e, 'Failed to load the board meeting.')); });
    return () => { cancelled = true; };
  }, [board.id]);

  useEffect(() => {
    if (!meeting) return;
    listMeetingParticipants(meeting.id)
      .then(r => setParts(r.data || []))
      .catch(e => setErr(errorMessage(e)));
  }, [meeting, reloadKey]);

  const kolIds = board.kolIds || [];
  const assignedKols = kolIds.map(id => kolDir.find(k => k.id === id)).filter(Boolean);
  const participantByKey = new Map(parts.map(p => [kolKeyOf(p), p]).filter(([k]) => k));
  const notInvited = kolIds.filter(id => !participantByKey.has(id));
  const refresh = () => setReloadKey(k => k + 1);

  const toggle = async (k) => {
    if (busyId) return;
    const assigned = kolIds.includes(k.id);
    const p = participantByKey.get(k.id);
    if (assigned && p && !window.confirm(
      `Remove ${k.name} from this board? Their meeting invite and personal login link stop working.`)) return;
    setBusyId(k.id); setErr('');
    try {
      const next = assigned ? kolIds.filter(id => id !== k.id) : [...kolIds, k.id];
      if (!(await persist({ kolIds: next }))) return;
      if (!meeting) return;
      if (assigned && p) await removeMeetingParticipant(meeting.id, p.id);
      if (!assigned && !p) await inviteMeetingParticipants(meeting.id, [kolInvitee(k.id)]);
    } catch (e) {
      setErr(`${k.name}: ${errorMessage(e, 'the meeting invite could not be updated.')}`);
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  // Add a KOL to the directory without leaving the board, then assign + invite
  // them straight away — that is why you are on this tab.
  const createAndInvite = async () => {
    const name = newKol.name.trim();
    if (!name) { setErr('KOL name is required.'); return; }
    setSaving(true); setErr('');
    try {
      const r = await createBoardKol({
        name,
        specialty: newKol.specialty, affiliation: newKol.affiliation,
        country: newKol.country, email: newKol.email, phone: newKol.phone,
        tier: newKol.tier, notes: newKol.notes,
      });
      const id = `own:${r.data.id}`;
      await reloadKolDir();
      if (await persist({ kolIds: [...kolIds, id] }) && meeting) {
        await inviteMeetingParticipants(meeting.id, [kolInvitee(id)]);
      }
      setNewKol(EMPTY_KOL); setCreating(false);
    } catch (e) {
      setErr(errorMessage(e, 'Could not add the KOL.'));
    } finally {
      setSaving(false); refresh();
    }
  };

  const inviteMissing = async () => {
    if (!meeting || notInvited.length === 0) return;
    setBusyId('all'); setErr('');
    try { await inviteMeetingParticipants(meeting.id, notInvited.map(kolInvitee)); }
    catch (e) { setErr(errorMessage(e, 'Could not invite the KOLs.')); }
    finally { setBusyId(null); refresh(); }
  };

  // Removed from the invite list below → also off the panel.
  const onRemoved = (p) => {
    const key = kolKeyOf(p);
    if (key && kolIds.includes(key)) persist({ kolIds: kolIds.filter(id => id !== key) });
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0 }}>KOLs ({assignedKols.length})</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="form-control" placeholder="Search KOL directory…" value={kolQuery} onChange={e => setKolQuery(e.target.value)} style={{ minWidth: 240 }} />
            <button className="btn btn-sm btn-primary" onClick={() => { setCreating(c => !c); setErr(''); }}>
              <Plus size={13} /> New KOL
            </button>
          </div>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          Selecting a KOL adds them to this board and invites them to
          {meeting ? <> <strong>{meeting.title}</strong></> : ' the meeting'} — they are emailed
          their personal login link.
        </p>
        {err && <div className="alert alert-error" style={{ marginBottom: 10 }}>{err}</div>}
        {meeting && notInvited.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10, padding: '8px 12px', background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', borderRadius: 6, fontSize: '0.84rem' }}>
            <span>{notInvited.length} KOL{notInvited.length === 1 ? ' is' : 's are'} on the board but not invited to the meeting yet.</span>
            <button className="btn btn-sm btn-primary" onClick={inviteMissing} disabled={busyId === 'all'}>
              <Send size={12} /> {busyId === 'all' ? 'Inviting…' : 'Invite now'}
            </button>
          </div>
        )}
        {creating && (
          <div className="card" style={{ padding: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Field label="Full name *">
                <input className="form-control" value={newKol.name} autoFocus placeholder="Dr. Jane Doe"
                  onChange={e => setNewKol(k => ({ ...k, name: e.target.value }))} />
              </Field>
              <Field label="Specialty">
                <input className="form-control" value={newKol.specialty} placeholder="Oncology"
                  onChange={e => setNewKol(k => ({ ...k, specialty: e.target.value }))} />
              </Field>
              <Field label="Affiliation">
                <input className="form-control" value={newKol.affiliation} placeholder="Hospital / institution"
                  onChange={e => setNewKol(k => ({ ...k, affiliation: e.target.value }))} />
              </Field>
              <Field label="Country">
                <input className="form-control" value={newKol.country} placeholder="India"
                  onChange={e => setNewKol(k => ({ ...k, country: e.target.value }))} />
              </Field>
              <Field label="Email">
                <input className="form-control" type="email" value={newKol.email}
                  onChange={e => setNewKol(k => ({ ...k, email: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <input className="form-control" value={newKol.phone}
                  onChange={e => setNewKol(k => ({ ...k, phone: e.target.value }))} />
              </Field>
              <Field label="Tier">
                <select className="form-control" value={newKol.tier}
                  onChange={e => setNewKol(k => ({ ...k, tier: e.target.value }))}>
                  {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Notes" full>
                <textarea className="form-control" rows={2} value={newKol.notes}
                  placeholder="Areas of expertise, conflicts of interest, prior engagements…"
                  onChange={e => setNewKol(k => ({ ...k, notes: e.target.value }))} />
              </Field>
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
              Saved to your KOL list (Advisory Boards → KOLs), added to this board and invited to the
              meeting. Without an email address they are added but nothing can be sent.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setCreating(false); setNewKol(EMPTY_KOL); setErr(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={createAndInvite} disabled={saving || !newKol.name.trim()}>
                {saving ? 'Saving…' : 'Add & invite'}
              </button>
            </div>
          </div>
        )}
        {kolDir.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            No KOLs available yet. Add them on the <strong>KOLs</strong> tab of Advisory
            Boards, or in the <strong>KOL</strong> module — a board can draw from either.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {filteredKols.map(k => {
              const assigned = kolIds.includes(k.id);
              const p = participantByKey.get(k.id);
              return (
                <button key={k.id} onClick={() => toggle(k)} disabled={!!busyId} className="card" style={{
                  padding: 12, textAlign: 'left', cursor: busyId ? 'wait' : 'pointer',
                  border: `1px solid ${assigned ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
                  background: assigned ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                  transition: 'all var(--transition)', display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{k.name}</span>
                    {busyId === k.id
                      ? <Loader size={16} className="spinning" />
                      : assigned ? <CheckCircle2 size={16} style={{ color: 'var(--color-primary)' }} /> : <Circle size={16} style={{ color: 'var(--color-text-light)' }} />}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>{k.specialty || '—'}</div>
                  <span style={{
                    alignSelf: 'flex-start', fontSize: '0.66rem', fontWeight: 700, padding: '1px 7px',
                    borderRadius: 999, background: 'var(--color-surface-raised)',
                    color: k.source === 'hcp' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  }}>{k.sourceLabel}</span>
                  <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{[k.affiliation, k.country].filter(Boolean).join(' • ') || '—'}</div>
                  {assigned && (
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: p ? 'var(--color-success)' : 'var(--color-warning-text)' }}>
                      {p ? `Invited · ${p.invite_status}` : 'Not invited yet'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {meeting && (
        <ParticipantsSection meetingId={meeting.id} title="Meeting invites & access"
          reloadKey={reloadKey} onRemoved={onRemoved} />
      )}
    </div>
  );
}

// ── Meetings section (per-board list) ────────────────────

const MEETING_STATUS_COLORS = { scheduled: 'var(--color-info)', live: 'var(--color-success)', completed: 'var(--color-text-secondary)', cancelled: 'var(--color-error)' };

// 1 board = 1 meeting: mirrors the backend's `_board_meeting()` ordering
// (scheduled_at ascending with date-TBD first, then id) so the form edits the
// same row the API will update. Only legacy boards hold more than one.
function resolveBoardMeeting(meetings) {
  return [...(meetings || [])].sort((a, b) => {
    const ta = a.scheduled_at ? Date.parse(a.scheduled_at) : -Infinity;
    const tb = b.scheduled_at ? Date.parse(b.scheduled_at) : -Infinity;
    return ta - tb || a.id - b.id;
  })[0] || null;
}

function BoardMeetingsSection({ boardId, boardTitle }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const boardMeeting = resolveBoardMeeting(meetings);

  const reload = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await listBoardMeetings(boardId);
      setMeetings(r.data || []);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [boardId]);

  const openMeeting = (id) => {
    window.location.hash = `#meetings/${id}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0 }}>Meeting for "{boardTitle}"</h4>
        <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
          {boardMeeting
            ? <><Calendar size={14} /> Schedule meeting</>
            : <><Plus size={14} /> New Meeting</>}
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading meetings…</div>
      ) : err ? (
        <div className="card" style={{ padding: 16, borderLeft: '3px solid var(--color-error)' }}>
          <strong>Couldn't load meetings.</strong>
          <div style={{ fontSize: '0.84rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>{err}</div>
        </div>
      ) : meetings.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <Calendar size={28} style={{ color: 'var(--color-text-light)', marginBottom: 6 }} />
          <p style={{ margin: '0 0 12px', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
            No meetings scheduled for this board yet.
          </p>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={13} /> Schedule first meeting
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {meetings.map(m => {
            const when = m.scheduled_at ? new Date(m.scheduled_at) : null;
            const FmtIcon = m.format === 'in_person' ? MapPin : Video;
            const c = MEETING_STATUS_COLORS[m.status] || 'var(--color-text-secondary)';
            return (
              <button key={m.id} onClick={() => openMeeting(m.id)} style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 12,
                padding: '12px 16px', border: 'none', background: 'transparent', textAlign: 'left',
                borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer',
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${c}1A`, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FmtIcon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.title}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {when ? <><Clock size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{when.toLocaleString()}</> : 'Date TBD'}
                    <span style={{ margin: '0 6px' }}>•</span>
                    <Users size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{m.participant_count || 0}
                    <span style={{ margin: '0 6px' }}>•</span>
                    {m.duration_minutes || 60} min
                  </div>
                </div>
                <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: `${c}1A`, color: c }}>
                  {m.status}
                </span>
                <ArrowRight size={14} style={{ color: 'var(--color-text-light)' }} />
              </button>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateBoardMeetingModal
          boardId={boardId}
          existing={boardMeeting}
          onClose={() => setShowCreate(false)}
          onCreated={(newId) => {
            setShowCreate(false);
            if (newId) openMeeting(newId);
            else reload();
          }}
        />
      )}
    </div>
  );
}

// 1 board = 1 meeting. When the board already has one — including the bare row
// the workspace auto-creates on first open — this form configures *that* meeting
// rather than adding a second, so it is prefilled from it.
function CreateBoardMeetingModal({ boardId, board, existing, onClose, onCreated }) {
  const defaults = boardMeetingTimeDefaults(board);
  const [title, setTitle] = useState(existing?.title || '');
  const [agenda, setAgenda] = useState(existing?.agenda_summary || '');
  const [scheduledAt, setScheduledAt] = useState(
    existing?.scheduled_at ? existing.scheduled_at.slice(0, 16) : defaults.scheduledAt);
  const [duration, setDuration] = useState(existing?.duration_minutes || defaults.duration);
  const [format, setFormat] = useState(existing?.format || 'virtual');
  const [joinUrl, setJoinUrl] = useState('');
  const [autoZoom, setAutoZoom] = useState(false);
  const [zoomActive, setZoomActive] = useState(false);
  const [cfgStatus, setCfgStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  // Which platform this account picked in Account → Meeting Platforms. The form
  // has to follow it: asking for a Zoom link when meetings run on LiveKit is
  // exactly the confusion this replaced.
  const [activeProvider, setActiveProvider] = useState(null);
  const isLiveKit = activeProvider === 'livekit';

  useEffect(() => {
    getAccountConfigStatus()
      .then(r => {
        setCfgStatus(r.data || null);
        setActiveProvider(r.data?.active_provider || null);
        // Auto-provision is a Zoom concept, and only possible with the account's
        // own Zoom credentials.
        setZoomActive((r.data?.zoom?.source) === 'account' && r.data?.active_provider === 'zoom');
      })
      .catch(() => { setZoomActive(false); setActiveProvider(null); });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setSubmitting(true);
    try {
      const r = await createMeeting(boardId, {
        title: title.trim() || 'Untitled meeting',
        agenda_summary: agenda.trim() || null,
        scheduled_at: scheduledAt || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        duration_minutes: Number(duration) || 60,
        format,
        join_url: joinUrl.trim() || null,
        auto_provision_zoom: autoZoom && zoomActive,
      });
      onCreated(r.data?.id);
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message || 'Failed to create meeting');
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: 480, width: '100%', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--color-border-light)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            {existing ? 'Schedule this Board’s Meeting' : 'New Meeting for this Board'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ConfigHint status={cfgStatus} />
          <Field label="Meeting Title">
            <input className="form-control" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Q3 Kickoff" autoFocus />
          </Field>
          <Field label="Agenda Summary">
            <input className="form-control" value={agenda} onChange={e => setAgenda(e.target.value)} placeholder="One-line summary" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
            <Field label="Scheduled At">
              <input type="datetime-local" className="form-control" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
            </Field>
            <Field label="Minutes">
              <input type="number" min={15} step={15} className="form-control" value={duration} onChange={e => setDuration(e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isLiveKit ? '1fr' : '120px 1fr', gap: 10 }}>
            <Field label="Format">
              <select className="form-control" value={format} onChange={e => setFormat(e.target.value)}>
                <option value="virtual">Virtual</option>
                <option value="in_person">In-person</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </Field>
            {/* Only meaningful for an external platform. A LiveKit meeting has no
                URL to paste — the room is created by this app when people join. */}
            {!isLiveKit && (
              <Field label="Zoom URL (optional)">
                <input className="form-control" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} placeholder="https://zoom.us/j/…" disabled={autoZoom && zoomActive} />
              </Field>
            )}
          </div>
          {isLiveKit ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, background: '#FFF1EF', border: '1px solid #FFD5CE', borderRadius: 6, fontSize: '0.85rem' }}>
              <Video size={15} style={{ color: '#FF6352', marginTop: 2, flexShrink: 0 }} />
              <span>
                <strong>This meeting runs on LiveKit.</strong>{' '}
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Nothing to set up — the room opens inside this app when you join, with
                  video, screen share and recording included. Change this in{' '}
                  <a href="/account#meeting-platforms" style={{ color: 'var(--color-warning-text)', fontWeight: 600 }}>
                    Account → Meeting Platforms</a>.
                </span>
              </span>
            </div>
          ) : zoomActive && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, background: 'var(--color-info-bg)', borderRadius: 6, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={autoZoom} onChange={e => setAutoZoom(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <strong>Auto-create the Zoom meeting.</strong>{' '}
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Generates a Zoom session with cloud recording enabled.
                  {existing?.zoom_meeting_id && ' This board already has one — re-creating replaces it.'}
                </span>
              </span>
            </label>
          )}
          {existing && (
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              A board has one meeting. This updates <strong>{existing.title}</strong> — its
              participants, documents and surveys stay attached, and existing join links keep working.
            </p>
          )}
          {err && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error-text)', padding: 10, borderRadius: 6, fontSize: '0.83rem' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary"
              disabled={submitting || !isPlatformConfigured(cfgStatus)}
              title={!isPlatformConfigured(cfgStatus) ? 'Configure a meeting platform (Zoom/Teams) in Account → Meeting Platforms first' : undefined}>
              {submitting ? 'Saving…' : (existing ? 'Save Meeting' : 'Create Meeting')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditForm({ draft, setDraft, onSave, onCancel, masters, onCreatedMaster }) {
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const m = masters || { pharma_sponsor: [], therapeutic_area: [], region: [], currency: [] };
  const created = (type) => (opt) => onCreatedMaster?.(type, opt);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      <Field label="Board title *" full><input className="form-control" value={draft.title || ''} onChange={e => set('title', e.target.value)} /></Field>
      <Field label="Client / Pharma sponsor">
        <MasterCombobox type="pharma_sponsor" options={m.pharma_sponsor}
          values={draft.client || ''} onChange={(v) => set('client', v)}
          onCreated={created('pharma_sponsor')} />
      </Field>
      <Field label="Sponsor team / contact"><input className="form-control" value={draft.sponsor || ''} onChange={e => set('sponsor', e.target.value)} /></Field>
      <Field label="Therapeutic area">
        <MasterCombobox type="therapeutic_area" multi options={m.therapeutic_area}
          values={toList(draft.therapeuticArea)} onChange={(arr) => set('therapeuticArea', arr)}
          onCreated={created('therapeutic_area')} />
      </Field>
      <Field label="Region">
        <MasterCombobox type="region" multi options={m.region}
          values={toList(draft.region)} onChange={(arr) => set('region', arr)}
          onCreated={created('region')} />
      </Field>
      <Field label="Currency">
        <MasterCombobox type="currency" options={m.currency}
          values={draft.currency || 'USD'} onChange={(v) => set('currency', v)}
          onCreated={created('currency')} />
      </Field>
      <Field label="Format">
        <select className="form-control" value={draft.format || 'hybrid'} onChange={e => set('format', e.target.value)}>
          {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className="form-control" value={draft.status || 'planning'} onChange={e => set('status', e.target.value)}>
          {BOARD_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Scheduled date">
        <input type="date" className="form-control" value={(draft.scheduledDate || '').slice(0, 10)} onChange={e => set('scheduledDate', e.target.value)} />
      </Field>
      <Field label="Start time">
        <input type="time" className="form-control" value={draft.startTime || ''} onChange={e => set('startTime', e.target.value)} />
      </Field>
      <Field label="End time">
        <input type="time" className="form-control" value={draft.endTime || ''} onChange={e => set('endTime', e.target.value)} />
      </Field>
      <Field label="Venue / Platform" full>
        <input className="form-control" value={draft.venue || ''} onChange={e => set('venue', e.target.value)} placeholder="Hotel name, Zoom, MS Teams, etc." />
      </Field>
      <Field label="Objective" full>
        <textarea className="form-control" rows={2} value={draft.objective || ''} onChange={e => set('objective', e.target.value)} placeholder="What are we trying to learn / decide?" />
      </Field>
      <Field label="Internal notes" full>
        <textarea className="form-control" rows={2} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel}><X size={14} /> Cancel</button>
        <button className="btn btn-primary" onClick={onSave} disabled={!draft.title?.trim()}><Save size={14} /> Save changes</button>
      </div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function ServiceCard({ svc, selected, onToggle, locked = false }) {
  const phase = PHASE_BY_ID[svc.phase];
  const p = priceForService(svc.id);
  return (
    <button
      onClick={() => { if (!locked) onToggle(svc.id); }}
      disabled={locked}
      title={locked ? `Locked — ${phase.label} services can only be changed while the board is in that phase` : undefined}
      className="card"
      style={{
        padding: 12, textAlign: 'left', cursor: locked ? 'not-allowed' : 'pointer',
        border: `1px solid ${selected ? phase.color : 'var(--color-border-light)'}`,
        background: selected ? `${phase.color}0F` : 'var(--color-surface)',
        opacity: locked && !selected ? 0.55 : 1,
        transition: 'all var(--transition)', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${phase.color}1A`, color: phase.color }}>
          {phase.short}
        </span>
        {locked
          ? <Lock size={14} style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />
          : selected
            ? <CheckCircle2 size={16} style={{ color: phase.color, flexShrink: 0 }} />
            : <Circle size={16} style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />}
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.3 }}>{svc.name}</div>
      <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)', lineHeight: 1.35 }}>{svc.desc}</div>
      <div style={{ fontSize: '0.78rem', color: p.price > 0 ? 'var(--color-text)' : 'var(--color-text-light)', fontWeight: 600 }}>
        {p.price > 0 ? formatMoney(p.price, p.currency) : 'Price not set'}
        <span style={{ fontWeight: 400, color: 'var(--color-text-light)', marginLeft: 4 }}>/ {unitLabel(p.unit)}</span>
      </div>
    </button>
  );
}

function FilterPill({ active, onClick, label, color }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 11px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600,
      border: `1px solid ${active ? color : 'var(--color-border)'}`,
      background: active ? color : 'var(--color-text-inverse)', color: active ? 'var(--color-text-inverse)' : 'var(--color-text)',
      cursor: 'pointer',
    }}>{label}</button>
  );
}

const Th = ({ children, align = 'left', style }) => (
  <th style={{ padding: '10px 14px', textAlign: align, fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', ...style }}>{children}</th>
);
const Td = ({ children, align = 'left', style }) => (
  <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'top', ...style }}>{children}</td>
);
