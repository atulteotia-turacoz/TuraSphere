import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Calendar, Building2, MapPin, Users, Briefcase, ChevronRight, ChevronDown,
  Search, X, CheckCircle2, Circle, Video, MoreVertical, Trash2, Ban, PlayCircle, FileText,
  Download, AlertTriangle,
} from 'lucide-react';
import {
  listBoards, createBoard, updateBoard, deleteBoard,
  BOARD_STATUSES, BOARD_STATUS_BY_ID,
  PHASES, PHASE_BY_ID, SERVICES, FEE_UNITS,
  estimateBoardCost, priceForService, formatMoney, toList,
} from './data';
import BoardDetail from './BoardDetail';
import { CreateMeetingModal } from './MeetingsTab';
import TranscriptViewerModal from './TranscriptViewerModal';
import { getMasterData, createMyCategory } from '../../services/api';

const FORMATS = [
  { id: 'in_person', label: 'In-Person' },
  { id: 'virtual',   label: 'Virtual' },
  { id: 'hybrid',    label: 'Hybrid' },
];

// Phases temporarily hidden from the New Advisory Board service picker (mirrors
// the same hide in BoardDetail.js). Remove ids here to bring a phase back.
const HIDDEN_SERVICE_PHASES = ['ongoing_support', 'event_specific'];
const VISIBLE_SERVICE_PHASES = PHASES.filter((p) => !HIDDEN_SERVICE_PHASES.includes(p.id));

const blankBoard = {
  title: '', client: '', sponsor: '', therapeuticArea: [], region: [],
  currency: 'USD', status: 'planning', currentPhase: 'pre_meeting',
  scheduledDate: '', startTime: '', endTime: '',
  format: 'hybrid', venue: '', objective: '', notes: '',
  serviceIds: [],
};

const unitLabel = (unit) => FEE_UNITS.find((u) => u.id === unit)?.label || unit;

export default function BoardsTab({ initialBoardId, onSelectionChange, initialSection, onSectionChange, meId, isPlatformAdmin }) {
  const [boards, setBoards] = useState([]);
  const [selectedId, setSelectedId] = useState(initialBoardId || null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [transcriptFor, setTranscriptFor] = useState(null);  // { meeting, title } → transcript viewer
  const [form, setForm] = useState(blankBoard);
  const [statusFilter, setStatusFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [query, setQuery] = useState('');
  const [masters, setMasters] = useState({ pharma_sponsor: [], therapeutic_area: [], region: [], currency: [] });
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const handleCreatedMaster = (type, item) =>
    setMasters((prev) => ({ ...prev, [type]: [...(prev[type] || []), item] }));

  const refresh = async () => {
    setLoadErr(null);
    try {
      const data = await listBoards();
      setBoards(data);
    } catch (e) {
      setLoadErr(e.response?.data?.detail || e.message || 'Failed to load boards');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
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
    }).catch(() => { /* dropdowns just stay empty if the call fails */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { setSelectedId(initialBoardId || null); }, [initialBoardId]);
  useEffect(() => { onSelectionChange?.(selectedId); }, [selectedId, onSelectionChange]);
  // clear stale selection if the underlying board has been deleted
  useEffect(() => {
    if (selectedId && boards.length > 0 && !boards.find(b => b.id === selectedId)) {
      setSelectedId(null);
    }
  }, [boards, selectedId]);

  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const submitCreate = async () => {
    if (!form.title.trim()) return;
    setCreating(true); setCreateErr(null);
    try {
      const b = await createBoard(form);
      await refresh();
      setForm(blankBoard);
      setShowCreate(false);
      setSelectedId(b.id);
    } catch (e) {
      setCreateErr(e.response?.data?.detail || e.message || 'Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const closeCreate = () => {
    if (creating) return;
    setShowCreate(false);
    setForm(blankBoard);
    setCreateErr(null);
  };

  // ── Row-level lifecycle actions (account holder / board owner) ──────────
  // The backend already scopes update/delete to the board creator, assigned
  // team members, and platform admins, so any board in this list is one the
  // current user is allowed to manage. `cancelled` is the model's deactivated
  // state — there's no separate active flag — so Deactivate → cancelled and
  // Activate → planning.
  const [rowBusyId, setRowBusyId] = useState(null);

  const setBoardStatus = async (board, status) => {
    setRowBusyId(board.id);
    try {
      await updateBoard(board.id, { status });
      await refresh();
    } catch (e) {
      alert(e.response?.data?.detail || e.message || 'Failed to update board');
    } finally {
      setRowBusyId(null);
    }
  };

  const cancelBoard = (board) => {
    if (!window.confirm(`Deactivate (cancel) advisory board "${board.title}"? You can reactivate it later.`)) return;
    setBoardStatus(board, 'cancelled');
  };

  const activateBoard = (board) => setBoardStatus(board, 'planning');

  const removeBoard = async (board) => {
    if (!window.confirm(`Delete advisory board "${board.title}"? This cannot be undone.`)) return;
    setRowBusyId(board.id);
    try {
      await deleteBoard(board.id);
      if (selectedId === board.id) setSelectedId(null);
      await refresh();
    } catch (e) {
      alert(e.response?.data?.detail || e.message || 'Failed to delete board');
    } finally {
      setRowBusyId(null);
    }
  };

  if (selectedId) {
    const board = boards.find(b => b.id === selectedId);
    if (board) {
      return <BoardDetail board={board} onBack={() => setSelectedId(null)} onChange={refresh}
                          initialSection={initialSection}
                          onSectionChange={(s) => onSectionChange?.(board.id, s)} />;
    }
    // board missing — render the list while the cleanup effect resets the selection.
  }

  const filtered = boards.filter(b => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (phaseFilter !== 'all' && b.currentPhase !== phaseFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const haystack = [
      b.title, b.client, b.sponsor,
      ...toList(b.therapeuticArea),
      ...toList(b.region),
    ];
    return haystack.some(v => (v || '').toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'value': return (estimateBoardCost(b).total || 0) - (estimateBoardCost(a).total || 0);
      case 'title': return (a.title || '').localeCompare(b.title || '');
      case 'phase': {
        // Ordered by lifecycle position, not alphabetically — "Post-Meeting"
        // sorting before "Pre-Meeting" would be nonsense.
        const idx = (x) => PHASES.findIndex(p => p.id === x.currentPhase);
        return idx(a) - idx(b);
      }
      case 'oldest': {
        const t = (x) => (x.scheduledDate ? new Date(x.scheduledDate).getTime() : Infinity);
        return t(a) - t(b);
      }
      default: { // soonest scheduled first, undated last
        const t = (x) => (x.scheduledDate ? new Date(x.scheduledDate).getTime() : Infinity);
        return t(a) - t(b);
      }
    }
  });

  const filtersActive = statusFilter !== 'all' || phaseFilter !== 'all' || Boolean(query.trim());
  const clearFilters = () => { setStatusFilter('all'); setPhaseFilter('all'); setQuery(''); };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Title', 'Client', 'Status', 'Phase', 'Scheduled', 'Region', 'Therapeutic area', 'KOLs', 'Services', 'Estimate'];
    const lines = sorted.map(b => {
      const c = estimateBoardCost(b);
      return [
        b.title, b.client, BOARD_STATUS_BY_ID[b.status]?.label || b.status,
        PHASE_BY_ID[b.currentPhase]?.label || b.currentPhase,
        b.scheduledDate ? new Date(b.scheduledDate).toLocaleDateString() : '',
        toList(b.region).join('; '), toList(b.therapeuticArea).join('; '),
        (b.kolIds || []).length, (b.serviceIds || []).length,
        c.total > 0 ? formatMoney(c.total, c.currency) : '',
      ].map(esc).join(',');
    });
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `advisory-boards-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Advisory Boards</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            {boards.length} engagement{boards.length === 1 ? '' : 's'} on file. Track each board through its full lifecycle.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* "Create Meeting" button hidden for now (create meetings from within a board / the Meetings tab). */}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> New Advisory Board</button>
        </div>
      </div>

      {showCreateMeeting && (
        <CreateMeetingModal
          onClose={() => setShowCreateMeeting(false)}
          onCreated={(newMeetingId) => {
            setShowCreateMeeting(false);
            if (newMeetingId) window.location.hash = `#meetings/${newMeetingId}`;
          }}
        />
      )}

      {transcriptFor && (
        <TranscriptViewerModal
          meetingId={transcriptFor.meeting.id}
          title={transcriptFor.title}
          onClose={() => setTranscriptFor(null)}
        />
      )}

      {showCreate && (
        <NewBoardModal
          form={form}
          setForm={setForm}
          masters={masters}
          onCreatedMaster={handleCreatedMaster}
          onCancel={closeCreate}
          onSubmit={submitCreate}
          submitting={creating}
          err={createErr}
        />
      )}

      {/* Filters */}
      {boards.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14, alignItems: 'center' }}>
          <FilterPill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} label="All" color="var(--color-text-secondary)" count={boards.length} />
          {BOARD_STATUSES.map(s => {
            const c = boards.filter(b => b.status === s.id).length;
            if (c === 0) return null;
            return <FilterPill key={s.id} active={statusFilter === s.id} onClick={() => setStatusFilter(s.id)} label={s.label} color={s.color} count={c} />;
          })}
          <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
            <input className="form-control" placeholder="Search boards…" value={query} onChange={e => setQuery(e.target.value)} style={{ paddingLeft: 32 }} />
          </div>

          {/* Phase is a separate axis from status: a board can be Planning while
              already sitting in the Meeting phase, so filtering needs both. */}
          <select className="form-control filter-select" value={phaseFilter} onChange={e => setPhaseFilter(e.target.value)}>
            <option value="all">All phases</option>
            {PHASES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          <select className="form-control filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="date">Soonest first</option>
            <option value="oldest">Latest first</option>
            <option value="phase">By lifecycle phase</option>
            <option value="value">Highest estimate</option>
            <option value="title">Title A–Z</option>
          </select>

          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={sorted.length === 0}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      )}

      {boards.length > 0 && (
        <div className="filter-summary">
          <span>Showing <strong>{sorted.length}</strong> of <strong>{boards.length}</strong> board{boards.length === 1 ? '' : 's'}</span>
          {filtersActive && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading boards…
        </div>
      ) : loadErr ? (
        <div className="card" style={{ padding: 20, borderLeft: '3px solid var(--color-danger, var(--color-error))' }}>
          <strong>Couldn't load boards.</strong>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>{loadErr}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: 8 }}>
            If you just added the MABM tables, restart the backend so they get created.
          </div>
        </div>
      ) : boards.length === 0 ? (
        <div className="card" style={{ padding: '60px 32px', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Briefcase size={28} style={{ color: 'var(--color-primary)' }} />
          </div>
          <h3 style={{ marginBottom: 4 }}>No advisory boards yet</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 18 }}>Create your first advisory board to start planning the engagement.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> New Advisory Board</button>
        </div>
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          No boards match your filters.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(b => (
            <BoardRow
              key={b.id}
              board={b}
              busy={rowBusyId === b.id}
              onClick={() => setSelectedId(b.id)}
              onCancel={() => cancelBoard(b)}
              onActivate={() => activateBoard(b)}
              onDelete={() => removeBoard(b)}
              onJoin={(m) => window.open(`/meeting-room/${m.id}`, '_blank')}
              onTranscript={(m) => setTranscriptFor({ meeting: m, title: b.title })}
              canViewTranscript={isPlatformAdmin || (!!meId && b.primaryMeeting?.organizer_id === meId)}
            />
          ))}
        </div>
      )}

    </div>
  );
}

// ── New board modal ─────────────────────────────────────────────────────
// Single-screen flow: collect basics, then pick services across every phase.
// We deliberately let users pre-select services for phases they aren't in
// yet; once the board moves past pre_meeting, those upstream phases lock
// down so the catalog only changes through the proper phase window.
function NewBoardModal({ form, setForm, masters, onCreatedMaster, onCancel, onSubmit, submitting, err }) {
  const set = (k, v) => setForm({ ...form, [k]: v });
  const created = (type) => (opt) => onCreatedMaster?.(type, opt);

  const selected = new Set(form.serviceIds || []);
  const toggleService = (svcId) => {
    const next = new Set(selected);
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    set('serviceIds', Array.from(next));
  };

  // Default: open Pre-Meeting (first phase) so the user has somewhere obvious
  // to start. Other phases collapse to keep the modal visually short.
  const [openPhases, setOpenPhases] = useState(() => ({ [PHASES[0].id]: true }));
  const togglePhase = (id) => setOpenPhases((p) => ({ ...p, [id]: !p[id] }));

  const cost = useMemo(() => estimateBoardCost({ ...form, kolIds: form.kolIds || [] }), [form]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 820, width: '95%' }}
      >
        <div className="modal-header" style={{ background: 'var(--color-primary-bg)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-primary)' }}>New Advisory Board</h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
              Capture the basics and pick services across every phase. You can refine each phase later as the board progresses.
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onCancel} disabled={submitting}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {/* ── Section: Basics ────────────────────────────────── */}
          <SectionHeader title="1. Board details" />
          <div style={{ padding: '14px 22px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Board title *" full>
              <input className="form-control" placeholder="e.g. APAC Oncology Advisory Board — Q3" value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus />
            </Field>
            <Field label="Client / Pharma sponsor">
              <MasterCombobox type="pharma_sponsor" options={masters.pharma_sponsor}
                values={form.client} onChange={(v) => set('client', v)}
                onCreated={created('pharma_sponsor')} placeholder="Type or select…" />
            </Field>
            <Field label="Therapeutic area">
              <MasterCombobox type="therapeutic_area" multi options={masters.therapeutic_area}
                values={form.therapeuticArea} onChange={(arr) => set('therapeuticArea', arr)}
                onCreated={created('therapeutic_area')} placeholder="Type or select…" />
            </Field>
            <Field label="Region">
              <MasterCombobox type="region" multi options={masters.region}
                values={form.region} onChange={(arr) => set('region', arr)}
                onCreated={created('region')} placeholder="Type or select…" />
            </Field>
            <Field label="Format">
              <select className="form-control" value={form.format} onChange={(e) => set('format', e.target.value)}>
                {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Currency">
              <MasterCombobox type="currency" options={masters.currency}
                values={form.currency} onChange={(v) => set('currency', v)}
                onCreated={created('currency')} placeholder="Type or select…" />
            </Field>
            <Field label="Scheduled date">
              <input type="date" className="form-control" value={form.scheduledDate} onChange={(e) => set('scheduledDate', e.target.value)} />
            </Field>
            <Field label="Start time">
              <input type="time" className="form-control" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
            <Field label="End time">
              <input type="time" className="form-control" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </Field>
            <Field label="Objective" full>
              <textarea className="form-control" rows={2} value={form.objective} onChange={(e) => set('objective', e.target.value)} placeholder="What we want to learn / decide" />
            </Field>
          </div>

          {/* ── Section: Services across all phases ────────────── */}
          <SectionHeader
            title="2. Services across all phases"
            right={
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                {selected.size} selected
                {cost.total > 0 && (
                  <>
                    <span style={{ margin: '0 6px', color: 'var(--color-border)' }}>•</span>
                    <strong style={{ color: 'var(--color-primary)' }}>{formatMoney(cost.total, cost.currency)}</strong>
                    <span style={{ color: 'var(--color-text-light)', marginLeft: 4 }}>est.</span>
                  </>
                )}
              </span>
            }
          />
          <div style={{ padding: '6px 22px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {VISIBLE_SERVICE_PHASES.map((phase) => {
              const phaseServices = SERVICES.filter((s) => s.phase === phase.id);
              const phaseSelected = phaseServices.filter((s) => selected.has(s.id)).length;
              const isOpen = !!openPhases[phase.id];
              return (
                <div key={phase.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)' }}>
                  <button
                    type="button"
                    onClick={() => togglePhase(phase.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', border: 'none', background: isOpen ? `${phase.color}10` : 'var(--color-surface)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: phase.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text)' }}>{phase.label}</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', marginTop: 1 }}>
                        {phaseSelected} of {phaseServices.length} selected
                      </div>
                    </div>
                    {phaseSelected > 0 && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                        background: `${phase.color}1A`, color: phase.color,
                      }}>{phaseSelected}</span>
                    )}
                    {isOpen ? <ChevronDown size={16} style={{ color: 'var(--color-text-secondary)' }} /> : <ChevronRight size={16} style={{ color: 'var(--color-text-secondary)' }} />}
                  </button>
                  {isOpen && (
                    <div style={{ padding: 12, borderTop: '1px solid var(--color-border-light)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                      {phaseServices.map((svc) => (
                        <CompactServiceCard
                          key={svc.id}
                          svc={svc}
                          selected={selected.has(svc.id)}
                          onToggle={() => toggleService(svc.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {err && (
            <div style={{ margin: '0 22px 16px', background: 'var(--color-error-bg)', color: 'var(--color-error-text)', padding: 10, borderRadius: 6, fontSize: '0.83rem' }}>
              {err}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={!form.title.trim() || submitting}>
            <Plus size={14} /> {submitting ? 'Creating…' : 'Create board'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, right }) {
  return (
    <div style={{
      padding: '12px 22px', borderTop: '1px solid var(--color-border-light)',
      borderBottom: '1px solid var(--color-border-light)',
      background: 'var(--color-bg-muted, var(--color-bg))',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      {right}
    </div>
  );
}

function CompactServiceCard({ svc, selected, onToggle }) {
  const phase = PHASE_BY_ID[svc.phase];
  const p = priceForService(svc.id);
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: 10, textAlign: 'left', cursor: 'pointer',
        border: `1px solid ${selected ? phase.color : 'var(--color-border-light)'}`,
        borderRadius: 6, background: selected ? `${phase.color}0F` : 'var(--color-surface)',
        display: 'flex', flexDirection: 'column', gap: 4, transition: 'all var(--transition)',
      }}
      title={svc.desc}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.3, flex: 1 }}>{svc.name}</span>
        {selected
          ? <CheckCircle2 size={14} style={{ color: phase.color, flexShrink: 0, marginTop: 1 }} />
          : <Circle size={14} style={{ color: 'var(--color-text-light)', flexShrink: 0, marginTop: 1 }} />}
      </div>
      <div style={{ fontSize: '0.72rem', color: p.price > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-light)', fontWeight: p.price > 0 ? 600 : 500 }}>
        {p.price > 0 ? formatMoney(p.price, p.currency) : 'Price not set'}
        <span style={{ fontWeight: 400, marginLeft: 4 }}>/ {unitLabel(p.unit)}</span>
      </div>
    </button>
  );
}

/** The five lifecycle phases as a compact track, with the current one marked. */
function PhaseTrack({ current }) {
  const idx = Math.max(0, PHASES.findIndex(p => p.id === current));
  return (
    <div className="phase-track" aria-label={`Phase: ${PHASE_BY_ID[current]?.label || 'unknown'}`}>
      {PHASES.map((p, i) => (
        <span
          key={p.id}
          className={`phase-step${i < idx ? ' is-done' : ''}${i === idx ? ' is-current' : ''}`}
          title={p.label}
        >
          <span className="phase-step-bar" />
          <span className="phase-step-label">{p.short}</span>
        </span>
      ))}
    </div>
  );
}

function BoardRow({ board, onClick, onCancel, onActivate, onDelete, onJoin, onTranscript, busy, canViewTranscript }) {
  const status = BOARD_STATUS_BY_ID[board.status] || BOARD_STATUSES[0];
  const phase  = PHASE_BY_ID[board.currentPhase] || PHASES[0];
  const cost   = estimateBoardCost(board);
  const date   = board.scheduledDate ? new Date(board.scheduledDate).toLocaleDateString() : 'Date TBD';
  const isCancelled = board.status === 'cancelled';

  // What is missing before this board can actually run. Same checks as the
  // Overview tab's readiness card, surfaced per row so the gap sits next to the
  // board it belongs to.
  const gaps = [
    !board.primaryMeeting && 'No meeting',
    (board.kolIds || []).length === 0 && 'No KOLs',
    !(board.objective || '').trim() && 'No objective',
    !board.scheduledDate && 'No date',
  ].filter(Boolean);

  const openDetail = () => { if (!busy) onClick(); };
  const onKeyOpen = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); }
  };

  return (
    <div className="card" style={{
      padding: '14px 18px', width: '100%', border: '1px solid var(--color-border-light)',
      transition: 'all var(--transition)', display: 'flex', alignItems: 'center', gap: 14,
      opacity: isCancelled ? 0.72 : 1,
      // override .card's overflow:hidden so the row actions dropdown isn't clipped
      overflow: 'visible', position: 'relative',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border-light)'}>
      <div
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={onKeyOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, cursor: busy ? 'default' : 'pointer', textAlign: 'left' }}
      >
        <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: phase.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{board.title}</span>
            <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: `${status.color}1A`, color: status.color }}>{status.label}</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, background: `${phase.color}1A`, color: phase.color }}>{phase.label}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
            {board.client && <Meta icon={<Building2 size={11} />}>{board.client}</Meta>}
            <Meta icon={<Calendar size={11} />}>{date}</Meta>
            {toList(board.region).length > 0 && <Meta icon={<MapPin size={11} />}>{toList(board.region).join(', ')}</Meta>}
            <Meta icon={<Users size={11} />}>{(board.kolIds || []).length} KOL{(board.kolIds || []).length === 1 ? '' : 's'}</Meta>
            <Meta icon={<Briefcase size={11} />}>{(board.serviceIds || []).length} service{(board.serviceIds || []).length === 1 ? '' : 's'}</Meta>
          </div>

          {/* The tab promises "track each board through its full lifecycle", but
              the row only ever named the current phase. This shows the whole
              run, so position is readable at a glance. */}
          {!isCancelled && <PhaseTrack current={board.currentPhase} />}

          {gaps.length > 0 && !isCancelled && (
            <div className="board-gaps">
              {gaps.map(g => (
                <span className="board-gap" key={g}><AlertTriangle size={10} /> {g}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Estimate</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: cost.total > 0 ? 'var(--color-primary)' : 'var(--color-text-light)' }}>
            {cost.total > 0 ? formatMoney(cost.total, cost.currency) : '—'}
          </div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />
      </div>
      <JoinMeetingButton meeting={board.primaryMeeting} onJoin={onJoin} />
      <RowActionsMenu
        board={board}
        busy={busy}
        isCancelled={isCancelled}
        onCancel={onCancel}
        onActivate={onActivate}
        onDelete={onDelete}
        onTranscript={onTranscript}
        canViewTranscript={canViewTranscript}
      />
    </div>
  );
}

// Join-video shortcut, shown once a meeting exists on the board. If the meeting
// has a join URL (Zoom/Teams provisioned) it opens that in a new tab; otherwise
// it deep-links to the meeting page where the link can be created.
function JoinMeetingButton({ meeting, onJoin }) {
  if (!meeting) return null;
  const hasLink = !!meeting.join_url;
  const open = (e) => {
    e.stopPropagation();
    // In-app room when there's a Zoom session; otherwise go to the meeting page
    // to create the link first.
    if (hasLink) onJoin?.(meeting);
    else window.location.hash = `#meetings/${meeting.id}`;
  };
  return (
    <button
      type="button"
      onClick={open}
      title={hasLink ? 'Join the video meeting (in-app)' : 'Open meeting (no video link yet)'}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${hasLink ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: hasLink ? 'var(--color-primary)' : 'var(--color-surface)',
        color: hasLink ? 'var(--color-text-inverse)' : 'var(--color-text-light)',
      }}
    >
      <Video size={16} />
    </button>
  );
}

// Kebab menu of lifecycle actions for the account holder: activate / deactivate
// (cancel) and delete. Closes on outside click or Escape.
function RowActionsMenu({ board, busy, isCancelled, onCancel, onActivate, onDelete, onTranscript, canViewTranscript }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn(); };

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="btn btn-sm btn-ghost"
        title="Board actions"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ padding: '6px 8px' }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 40, minWidth: 184,
          background: 'var(--color-surface)', border: '1px solid var(--color-border-light)', borderRadius: 8,
          boxShadow: '0 6px 18px rgba(15,23,42,0.12)', overflow: 'hidden', padding: 4,
        }}>
          {/* Transcripts are organizer-only; the API 403s for anyone else, so
              don't offer an action that cannot work. */}
          {board.primaryMeeting && canViewTranscript && (
            <MenuItem icon={<FileText size={15} />} onClick={run(() => onTranscript?.(board.primaryMeeting))}>View transcript</MenuItem>
          )}
          {isCancelled ? (
            <MenuItem icon={<PlayCircle size={15} />} onClick={run(onActivate)}>Activate</MenuItem>
          ) : (
            <MenuItem icon={<Ban size={15} />} onClick={run(onCancel)}>Deactivate (cancel)</MenuItem>
          )}
          <MenuItem icon={<Trash2 size={15} />} danger onClick={run(onDelete)}>Delete board</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 6,
        cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
        color: danger ? 'var(--color-error, var(--color-error))' : 'var(--color-text)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'var(--color-error-bg)' : 'var(--color-bg-secondary, var(--color-bg))'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {icon} {children}
    </button>
  );
}

function Meta({ icon, children }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{icon} {children}</span>;
}

function FilterPill({ active, onClick, label, color, count }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600,
      border: `1px solid ${active ? color : 'var(--color-border)'}`,
      background: active ? color : 'var(--color-text-inverse)', color: active ? 'var(--color-text-inverse)' : 'var(--color-text)',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      {label}
      {count !== undefined && (
        <span style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-surface-raised)', color: active ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)', padding: '0 6px', borderRadius: 999, fontSize: '0.7rem' }}>{count}</span>
      )}
    </button>
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

// Typeable combobox backed by master-data rows.
//   - single mode (default): `values` is a string; `onChange(string)`
//   - multi mode: pass `multi`; `values` is a string[]; `onChange(arr)`
// Typing filters the list. If `type` is provided and the typed text doesn't
// match anything, a "Create '…'" row appears that POSTs to /account/categories
// and selects the newly created option in place — no page redirect.
export function MasterCombobox({
  type, options, values, onChange, onCreated,
  multi = false, placeholder = 'Type or select…', allowCreate = true,
}) {
  const list = options || [];
  const selectedArr = multi
    ? (Array.isArray(values) ? values : [])
    : (values ? [values] : []);
  const labelFor = (v) => list.find((o) => o.value === v)?.label || v;

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  // When the user clicks "+ Create", we don't POST immediately — we set
  // pendingLabel and show a Yes/No prompt inside the dropdown.
  const [pendingLabel, setPendingLabel] = useState('');

  useEffect(() => {
    const onDoc = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) {
        setOpen(false);
        setErrMsg('');
        setPendingLabel('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim();
  const ql = q.toLowerCase();
  const filtered = list
    .filter((o) => !selectedArr.includes(o.value))
    .filter((o) => !ql || o.label.toLowerCase().includes(ql) || (o.value || '').toLowerCase().includes(ql));
  const exactMatch = q && list.some((o) =>
    o.label.toLowerCase() === ql || (o.value || '').toLowerCase() === ql,
  );
  const showCreate = allowCreate && !!type && q.length > 0 && !exactMatch;

  const addValue = (v) => {
    if (!v) return;
    if (multi) {
      if (selectedArr.includes(v)) return;
      onChange([...selectedArr, v]);
    } else {
      onChange(v);
      setOpen(false);
    }
    setQuery('');
    setErrMsg('');
  };

  const removeValue = (v) => {
    if (multi) onChange(selectedArr.filter((x) => x !== v));
    else onChange('');
  };

  const requestCreate = () => {
    if (!type || !q || creating) return;
    setPendingLabel(q);
    setErrMsg('');
  };

  const confirmCreate = async () => {
    const label = pendingLabel.trim();
    if (!type || !label || creating) return;
    setCreating(true); setErrMsg('');
    try {
      const res = await createMyCategory({ type, label });
      const created = res.data;
      onCreated?.(created);
      setPendingLabel('');
      addValue(created.value);
    } catch (err) {
      setErrMsg(err.response?.data?.detail || 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const cancelCreate = () => {
    setPendingLabel('');
    setErrMsg('');
    inputRef.current?.focus();
  };

  const onKey = (e) => {
    if (e.key === 'Backspace' && query === '' && selectedArr.length > 0) {
      e.preventDefault();
      removeValue(selectedArr[selectedArr.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pendingLabel) cancelCreate();
      else setOpen(false);
      setErrMsg('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (pendingLabel) confirmCreate();
      else if (filtered.length > 0) addValue(filtered[0].value);
      else if (showCreate) requestCreate();
    } else if (e.key === 'ArrowDown') {
      setOpen(true);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
        style={{
          border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)',
          padding: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          minHeight: 38, cursor: 'text',
        }}
      >
        {selectedArr.map((v) => (
          <span key={v} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
            padding: '3px 4px 3px 8px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600,
          }}>
            {labelFor(v)}
            <button type="button" title="Remove"
              onClick={(e) => { e.stopPropagation(); removeValue(v); }}
              style={{
                border: 'none', background: 'transparent', color: 'inherit',
                cursor: 'pointer', display: 'inline-flex', padding: 2, borderRadius: '50%',
              }}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={selectedArr.length === 0 ? placeholder : ''}
          style={{
            flex: '1 1 120px', minWidth: 80, border: 'none', outline: 'none',
            background: 'transparent', fontSize: '0.88rem', padding: '4px',
          }}
        />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
          background: 'var(--color-surface)', border: '1px solid var(--color-border-light)', borderRadius: 6,
          maxHeight: 240, overflowY: 'auto', boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
        }}>
          {filtered.length === 0 && !showCreate && !creating && (
            <div style={{ padding: '10px 12px', fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
              {q ? 'No matches.' : 'Start typing to search…'}
            </div>
          )}
          {filtered.map((o) => (
            <div key={o.id || o.value}
              onMouseDown={(e) => { e.preventDefault(); addValue(o.value); }}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.88rem' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-secondary, var(--color-bg))'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-surface)'}
            >
              {o.label}
              {o.is_global && (
                <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--color-text-light)' }}>built-in</span>
              )}
            </div>
          ))}
          {showCreate && !pendingLabel && (
            <div
              role="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestCreate(); }}
              style={{
                padding: '10px 12px', cursor: 'pointer', fontSize: '0.88rem',
                borderTop: filtered.length ? '1px solid var(--color-border-light)' : 'none',
                color: 'var(--color-primary)', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <Plus size={14} /> Create "{q}"
              <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 500 }}>
                Adds to your categories
              </span>
            </div>
          )}
          {pendingLabel && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                padding: '12px', borderTop: '1px solid var(--color-border-light)',
                background: 'var(--color-primary-bg)',
              }}
            >
              <div style={{ fontSize: '0.85rem', marginBottom: 8, color: 'var(--color-text)' }}>
                Add <strong>"{pendingLabel}"</strong> as a new option?
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  It will be saved to your Categories and selected here.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm btn-ghost"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelCreate(); }}
                  disabled={creating}>
                  No
                </button>
                <button type="button" className="btn btn-sm btn-primary"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); confirmCreate(); }}
                  disabled={creating}>
                  {creating ? 'Adding…' : 'Yes, add'}
                </button>
              </div>
            </div>
          )}
          {creating && !pendingLabel && (
            <div style={{ padding: '8px 12px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              Creating…
            </div>
          )}
          {errMsg && (
            <div style={{ padding: '8px 12px', fontSize: '0.82rem', color: 'var(--color-error)' }}>
              {errMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
