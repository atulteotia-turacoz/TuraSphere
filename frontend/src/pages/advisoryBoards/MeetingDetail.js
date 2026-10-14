import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft, Clock, Users, Video, MapPin, Plus, Trash2, Download,
  Upload, Play, Square, ExternalLink, Edit3, CheckCircle, MessageSquare, FileText,
  Eye, EyeOff, ClipboardList, BarChart3, X, Send, BookOpen,
  Link2, Link2Off, Copy, RefreshCw, RotateCcw, Shield, ChevronDown, ChevronRight, UserCheck, Briefcase, Maximize2,
} from 'lucide-react';
import {
  getMeeting, startMeeting, endMeeting, reopenMeeting,
  listAgendaItems, addAgendaItem, deleteAgendaItem,
  listMeetingParticipants, updateMeetingParticipant, removeMeetingParticipant,
  regenerateParticipantJoinToken, resendParticipantInvite,
  listMeetingDocuments, uploadMeetingDocument, updateMeetingDocument, deleteMeetingDocument, downloadMeetingDocument,
  previewMeetingDocument, listMeetingSections, createMeetingSection, deleteMeetingSection,
  createDocumentShareLink, revokeDocumentShareLink, publicDocumentUrl,
  getMeetingRecording, getMeetingRecordingPlayUrl, deleteMeetingRecording, uploadMeetingRecording,
  getMeetingTranscript, generateMeetingTranscript, getRecordingTranscript,
  downloadRecordingTranscript, createMeetingTranscript, editMeetingTranscript, finalizeMeetingTranscript,
  listMeetingSurveys, linkMeetingSurvey, unlinkMeetingSurvey,
  listMeetingPolls, linkMeetingPoll, unlinkMeetingPoll,
  listSurveys, listPolls, syncMeetingFromZoom,
  getMeetingMinutes, createMeetingMinutes, editMeetingMinutes,
  shareMeetingMinutes, finalizeMeetingMinutes,
  listMeetingMinutesComments, addMeetingMinutesComment, deleteMeetingMinutesComment,
  listMeetingManuscripts, createManuscript, updateManuscript,
  transitionManuscriptStatus, addManuscriptComment, deleteManuscript,
  getMeetingEngagement,
  getMeetingDiscussion, addMeetingSessionComment, deleteMeetingSessionComment,
  addMeetingComment, deleteMeetingComment,
  provisionMeetingLink, listConfiguredProviders, updateMeeting,
} from '../../services/api';
import { errorMessage } from '../../utils/apiError';
import EngagementDashboard from './EngagementDashboard';
import SessionDiscussion from './SessionDiscussion';
import DocumentPreviewModal from '../../components/common/DocumentPreviewModal';

const PHASES = [
  { id: 'pre',    label: 'Pre-Meeting',  color: 'var(--color-primary)' },
  { id: 'during', label: 'During',       color: 'var(--color-info)' },
  { id: 'post',   label: 'Post-Meeting', color: 'var(--color-success)' },
];

const STATUS_COLORS = { scheduled: 'var(--color-info)', live: 'var(--color-success)', completed: 'var(--color-text-secondary)', cancelled: 'var(--color-error)' };
const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', completed: 'Completed', cancelled: 'Cancelled' };

export default function MeetingDetail({ meetingId, onBack }) {
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const reload = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await getMeeting(meetingId);
      setMeeting(r.data);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Failed to load meeting');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [meetingId]);

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading meeting…</div>;
  }
  if (err || !meeting) {
    return (
      <div>
        <button className="btn btn-sm btn-ghost" onClick={onBack}><ArrowLeft size={14} /> Back to Meetings</button>
        <div className="card" style={{ marginTop: 12, padding: 20 }}>
          <strong>Couldn't load meeting.</strong>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>{err || 'Unknown error'}</div>
        </div>
      </div>
    );
  }

  const when = meeting.scheduled_at ? new Date(meeting.scheduled_at) : null;
  const FmtIcon = meeting.format === 'in_person' ? MapPin : Video;
  const status = meeting.status;

  const STATUS_ACTIONS = { start: startMeeting, end: endMeeting, reopen: reopenMeeting };
  const setStatus = async (action) => {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      await STATUS_ACTIONS[action](meeting.id);
      await reload();
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    } finally {
      setStatusBusy(false);
    }
  };

  const joinable = meeting.video_provider === 'livekit' || meeting.join_url;
  // Open on the phase the meeting is actually in — landing a completed meeting
  // on "Pre-Meeting" hides the recording and minutes you came for.
  const workspacePhase = status === 'live' ? 'during' : status === 'completed' ? 'post' : 'pre';

  return (
    <div className="meeting-detail">
      <div className="bd-back">
        <button className="btn btn-sm btn-ghost" onClick={onBack}>
          <ArrowLeft size={14} /> All meetings
        </button>
        <ChevronRight size={13} className="bd-back-sep" aria-hidden="true" />
        <span className="bd-back-current">{meeting.title}</span>
      </div>

      <div className="card bd-hero">
        <div className="bd-hero-top">
          <div className="bd-identity">
            <div className="bd-title-row">
              <h2 className="bd-title">{meeting.title}</h2>
              <span className="bd-pill" style={{ background: `${STATUS_COLORS[status]}1A`, color: STATUS_COLORS[status] }}>
                {STATUS_LABELS[status] || status}
              </span>
              {status === 'live' && <span className="md-live"><span className="md-live-dot" /> in progress</span>}
            </div>
            <div className="bd-meta">
              {meeting.board_title && <span><Briefcase size={12} /> {meeting.board_title}</span>}
              <span><Clock size={12} /> {when ? when.toLocaleString() : 'Date TBD'}</span>
              <span><FmtIcon size={12} /> {meeting.format}</span>
            </div>
            {meeting.agenda_summary && <p className="md-summary">{meeting.agenda_summary}</p>}
          </div>
          <div className="bd-actions">
            {(status === 'scheduled' || status === 'live') && (
              <button className="btn btn-sm btn-ghost" onClick={() => setEditOpen(true)}
                title="Edit title, agenda, date, duration and format">
                <Edit3 size={13} /> Edit
              </button>
            )}
            {joinable && (
              <button className="btn btn-sm btn-primary"
                onClick={() => window.open(`/meeting-room/${meeting.id}`, '_blank')}
                title="Join in this app — you get host controls, recording and transcript">
                <Video size={13} /> Join
              </button>
            )}
            {status === 'scheduled' && (
              <button className="btn btn-sm btn-outline" onClick={() => setStatus('start')} disabled={statusBusy}>
                <Play size={13} /> Start
              </button>
            )}
            {status === 'live' && (
              <button className="btn btn-sm btn-outline" onClick={() => setStatus('end')} disabled={statusBusy}>
                <Square size={13} /> End
              </button>
            )}
            {(status === 'completed' || status === 'cancelled') && (
              <button className="btn btn-sm btn-outline" onClick={() => setStatus('reopen')} disabled={statusBusy}
                title="Reopen this meeting so it can be started again">
                <RotateCcw size={13} /> Reopen
              </button>
            )}
            {meeting.join_url && (
              <a className="btn btn-sm btn-ghost" href={meeting.join_url} target="_blank" rel="noopener noreferrer"
                title="Open in Zoom instead">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>

        <div className="bd-stats">
          <div className="bd-stat as-static">
            <span className="bd-stat-label"><Clock size={12} /> When</span>
            <span className="bd-stat-value bd-stat-text">{relativeWhen(when, status)}</span>
          </div>
          <div className="bd-stat as-static">
            <span className="bd-stat-label"><Clock size={12} /> Duration</span>
            <span className="bd-stat-value">{meeting.duration_minutes || 60}<span className="bd-stat-of"> min</span></span>
          </div>
          <div className="bd-stat as-static">
            <span className="bd-stat-label"><Users size={12} /> Participants</span>
            <span className="bd-stat-value">{meeting.participant_count || 0}</span>
          </div>
          <div className="bd-stat as-static">
            <span className="bd-stat-label"><Video size={12} /> Platform</span>
            <span className="bd-stat-value bd-stat-text">
              {PROVIDER_META[meeting.video_provider]?.label || (meeting.video_provider === 'livekit' ? 'LiveKit' : '—')}
            </span>
          </div>
        </div>
      </div>

      {editOpen && (
        <EditMeetingModal meeting={meeting} onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); reload(); }} />
      )}

      <MeetingPlatformCard meeting={meeting} onChange={reload} />

      {/* The workspace itself — agenda, participants, documents, polls,
          recording, transcript, minutes. It was written and exported from this
          very file but only ever rendered inside the board, so this page said
          "managed in the Advisory Board workspace" and showed nothing. */}
      <div className="md-workspace">
        <MeetingWorkspace
          meetingId={meeting.id}
          zoomMeetingId={meeting.zoom_meeting_id}
          initialPhase={workspacePhase}
        />
      </div>
    </div>
  );
}

/** Edits a scheduled meeting. `PATCH /meetings/{id}` always existed, but no
 *  screen called it, so a meeting could not be changed once scheduled. */
function EditMeetingModal({ meeting, onClose, onSaved }) {
  const [title, setTitle] = useState(meeting.title || '');
  const [agenda, setAgenda] = useState(meeting.agenda_summary || '');
  // Stored as the wall-clock time the organizer picked; datetime-local wants YYYY-MM-DDTHH:mm.
  const [scheduledAt, setScheduledAt] = useState((meeting.scheduled_at || '').slice(0, 16));
  const [duration, setDuration] = useState(meeting.duration_minutes || 60);
  const [format, setFormat] = useState(meeting.format || 'virtual');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Meeting title is required'); return; }
    setSaving(true); setErr(null);
    try {
      const payload = {
        title: title.trim(),
        agenda_summary: agenda.trim() || null,
        duration_minutes: Number(duration) || 60,
        format,
      };
      // Only send the date when it changed — a no-op resend would still run the
      // overlap check and could block saving a title edit.
      if (scheduledAt !== (meeting.scheduled_at || '').slice(0, 16)) {
        payload.scheduled_at = scheduledAt || null;
        // Zoom needs to know which timezone the wall-clock time is in.
        payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      // A Zoom-linked meeting is updated in Zoom by the same call.
      const r = await updateMeeting(meeting.id, payload);
      if (r.data?.zoom_synced === false) {
        alert('Saved here, but this Zoom meeting no longer exists in Zoom. Re-create the Zoom link from the Platform card.');
      }
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2, 'Failed to update meeting'));
      setSaving(false);
    }
  };

  const label = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
  const field = { ...inputStyle, padding: '8px 10px', fontSize: '0.9rem' };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{
        maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border-light)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Edit Meeting</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={label}>Meeting Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} style={field} autoFocus />
          </div>
          <div>
            <label style={label}>Agenda Summary</label>
            <input value={agenda} onChange={e => setAgenda(e.target.value)} style={field} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
            <div>
              <label style={label}>Scheduled At</label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={field} />
            </div>
            <div>
              <label style={label}>Minutes</label>
              <input type="number" min={15} step={15} value={duration} onChange={e => setDuration(e.target.value)} style={field} />
            </div>
          </div>
          <div>
            <label style={label}>Format</label>
            <select value={format} onChange={e => setFormat(e.target.value)} style={field}>
              <option value="virtual">Virtual</option>
              <option value="in_person">In-person</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          {meeting.zoom_meeting_id && meeting.video_provider === 'zoom' && (
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              Changes are saved to the Zoom meeting as well.
            </div>
          )}
          {err && <div style={{ ...errStyle, marginBottom: 0 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** "Live now" / "in 3 days" / "2 hours ago" — a timestamp alone makes you count. */
function relativeWhen(date, status) {
  if (status === 'live') return 'Live now';
  if (!date) return 'Not set';
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

const PROVIDER_META = {
  zoom:  { label: 'Zoom',             color: '#2D8CFF' },
  teams: { label: 'Microsoft Teams',  color: '#5059C9' },
};

function MeetingPlatformCard({ meeting, onChange }) {
  const [providers, setProviders] = useState(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    listConfiguredProviders()
      .then(r => {
        setProviders(r.data || []);
        if (r.data?.length) setChoice(r.data.find(p => p.is_active)?.provider || r.data[0].provider);
      })
      .catch(() => setProviders([]));
  }, []);

  const provision = async () => {
    if (!choice) return;
    setBusy(true); setErr('');
    try { await provisionMeetingLink(meeting.id, choice); onChange(); }
    catch (e) { setErr(e.response?.data?.detail || 'Could not create the meeting link.'); }
    finally { setBusy(false); }
  };

  const current = meeting.provider_id ? PROVIDER_META[choice] : null;

  // A LiveKit meeting has no link to create — the room is made when someone
  // joins. Offering "Create meeting link" here implied the meeting was somehow
  // unfinished, when it is ready to join.
  if (meeting.video_provider === 'livekit') {
    return (
      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Video size={16} /> Meeting Platform
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
          <CheckCircle size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
          <span>
            Runs on <strong>LiveKit</strong>, built into this app — no link to create.
            Use <strong>Join</strong> above; participants use their own invite links.
          </span>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          Change this in <a href="/account#meeting-platforms" style={{ color: 'var(--color-primary)' }}>Account → Meeting Platforms</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Video size={16} /> Meeting Platform
      </h4>
      {providers === null ? (
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-light)' }}>Loading…</p>
      ) : providers.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-light)' }}>
          You haven't configured a meeting platform yet. Set up your own Zoom or Teams in
          <strong> <a href="/account#meeting-platforms" style={{ color: 'var(--color-primary)' }}>Account → Meeting Platforms</a></strong> to create a link.
        </p>
      ) : (
        <>
          {meeting.join_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: '0.85rem' }}>
              <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />
              <span>Meeting link is live{current ? ` on ${current.label}` : ''}.</span>
              <a href={meeting.join_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', wordBreak: 'break-all' }}>{meeting.join_url}</a>
            </div>
          ) : (
            <p style={{ margin: '0 0 10px', fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
              Choose a platform and create the meeting link.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="form-control" value={choice} onChange={e => setChoice(e.target.value)} style={{ width: 'auto' }}>
              {providers.map(p => (
                <option key={p.provider} value={p.provider}>
                  {PROVIDER_META[p.provider]?.label || p.provider}{p.is_active ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" onClick={provision} disabled={busy}>
              <Video size={13} /> {busy ? 'Creating…' : (meeting.join_url ? 'Re-create link' : 'Create meeting link')}
            </button>
          </div>
          {err && <div style={{ marginTop: 10, color: 'var(--color-error-text)', fontSize: '0.82rem' }}>{err}</div>}
        </>
      )}
    </div>
  );
}

// Reusable workspace: phase tabs + all per-meeting content sections. Rendered in
// the Advisory Board workspace (1 board = 1 meeting).
export function MeetingWorkspace({ meetingId, zoomMeetingId, initialPhase = 'pre' }) {
  const [phaseTab, setPhaseTab] = useState(initialPhase);
  // Hoisted out of the conditional render below — a hook must not be called
  // inside a branch. Memoised so EngagementDashboard's effect doesn't re-fire
  // on every parent render.
  const fetchEngagement = useCallback(() => getMeetingEngagement(meetingId), [meetingId]);
  // Same reason: hoisted and memoised so the discussion panel's effect doesn't
  // re-fire on every render of the workspace.
  const fetchDiscussion = useCallback(() => getMeetingDiscussion(meetingId), [meetingId]);
  // The thread is flat, so the session is always null: a comment belongs to the
  // meeting, not to one session.
  const postDiscussion = useCallback(
    (sessionId, body) => (sessionId == null
      ? addMeetingComment(meetingId, body)
      : addMeetingSessionComment(meetingId, sessionId, body)), [meetingId]);
  const deleteDiscussion = useCallback(
    (sessionId, commentId) => (sessionId == null
      ? deleteMeetingComment(meetingId, commentId)
      : deleteMeetingSessionComment(meetingId, sessionId, commentId)), [meetingId]);
  return (
    <div>
      <div style={{ borderBottom: '1px solid var(--color-border-light)', marginBottom: 18, display: 'flex', gap: 2 }}>
        {PHASES.map(p => {
          const active = phaseTab === p.id;
          return (
            <button key={p.id} onClick={() => setPhaseTab(p.id)} style={{
              padding: '10px 16px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${active ? p.color : 'transparent'}`,
              color: active ? p.color : 'var(--color-text-secondary)',
              fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', marginBottom: -1,
            }}>
              {p.label}
            </button>
          );
        })}
        <button onClick={() => setPhaseTab('engagement')} style={{
          padding: '10px 16px', border: 'none', background: 'transparent',
          borderBottom: `2px solid ${phaseTab === 'engagement' ? 'var(--color-violet)' : 'transparent'}`,
          color: phaseTab === 'engagement' ? 'var(--color-violet)' : 'var(--color-text-secondary)',
          fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', marginBottom: -1,
        }}>
          Engagement
        </button>
        {/* The panel's thread, where the team can answer it. Engagement counts
            the comments; this is where you read and reply to them. */}
        <button onClick={() => setPhaseTab('discussion')} style={{
          padding: '10px 16px', border: 'none', background: 'transparent',
          borderBottom: `2px solid ${phaseTab === 'discussion' ? 'var(--color-violet)' : 'transparent'}`,
          color: phaseTab === 'discussion' ? 'var(--color-violet)' : 'var(--color-text-secondary)',
          fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', marginBottom: -1,
        }}>
          Discussion
        </button>
      </div>
      {phaseTab === 'pre' && <PrePhase meetingId={meetingId} />}
      {phaseTab === 'during' && <DuringPhase meetingId={meetingId} />}
      {phaseTab === 'post' && <PostPhase meetingId={meetingId} zoomMeetingId={zoomMeetingId} />}
      {phaseTab === 'engagement' && (
        <EngagementDashboard fetcher={fetchEngagement} />
      )}
      {phaseTab === 'discussion' && (
        <SessionDiscussion
          fetcher={fetchDiscussion} onPost={postDiscussion} onDelete={deleteDiscussion}
          title="Discussion"
          subtitle="The board's discussion — what the panel has said, and your replies. Everything here is visible to the experts and to the client."
        />
      )}
    </div>
  );
}

// ── Phase: Pre-meeting ───────────────────────────────────

function PrePhase({ meetingId }) {
  return (
    // `dense`: the documents card spans every column, and without it the card
    // after it starts a fresh row, leaving a hole beside the agenda.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, gridAutoFlow: 'dense' }}>
      {/* No Participants card: a board's KOLs ARE its meeting participants and
          are invited from the board's KOLs tab. */}
      <AgendaSection meetingId={meetingId} />
      <DocumentsSection meetingId={meetingId} phase="pre" title="Pre-Meeting Documents" />
      <SurveysSection meetingId={meetingId} phase="pre" title="Pre-Meeting Surveys" />
    </div>
  );
}

// ── Phase: During ────────────────────────────────────────

function DuringPhase({ meetingId }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, gridAutoFlow: 'dense' }}>
      <DocumentsSection meetingId={meetingId} phase="during" title="During-Meeting Documents" />
      <PollsSection meetingId={meetingId} />
      <div className="card" style={{ padding: 18 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 8 }}>Chat</h4>
        <p style={{ fontSize: '0.83rem', color: 'var(--color-text-secondary)', margin: 0 }}>
          In-meeting chat uses Zoom (Phase 4). Backend chat persistence is not in Phase 1.
        </p>
      </div>
    </div>
  );
}

// ── Phase: Post-meeting ──────────────────────────────────

function PostPhase({ meetingId, zoomMeetingId }) {
  // bump this to force Recording + Transcript to reload after a Zoom sync
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, gridAutoFlow: 'dense' }}>
      <DocumentsSection meetingId={meetingId} phase="post" title="Post-Meeting Documents" />
      <SurveysSection meetingId={meetingId} phase="post" title="Post-Meeting Surveys" />
      <RecordingSection key={`rec-${reloadKey}`} meetingId={meetingId} zoomMeetingId={zoomMeetingId} onSynced={() => setReloadKey(k => k + 1)} />
      <TranscriptSection key={`tr-${reloadKey}`} meetingId={meetingId} />
      <MinutesSection meetingId={meetingId} />
      <ManuscriptsSection meetingId={meetingId} />
    </div>
  );
}

// ── Agenda ───────────────────────────────────────────────

// Selectable agenda-item durations: every 5 min up to an hour, then 90 / 120.
const AGENDA_DURATIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 90, 120];

function AgendaSection({ meetingId }) {
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [err, setErr] = useState(null);

  const load = async () => {
    try { setItems((await listAgendaItems(meetingId)).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId]);

  const add = async () => {
    if (!title.trim()) {
      setErr('Topic is required.');
      return;
    }
    try {
      await addAgendaItem(meetingId, {
        sequence: items.length,
        title: title.trim(),
        duration_minutes: duration ? Number(duration) : null,
      });
      setTitle(''); setDuration(''); setAdding(false); setErr(null);
      load();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this agenda item?')) return;
    await deleteAgendaItem(meetingId, id);
    load();
  };

  return (
    <SectionCard title="Agenda" onAdd={() => setAdding(true)}>
      {err && <div style={errStyle}>{err}</div>}
      {items.length === 0 && !adding && (
        <div style={emptyStyle}>No agenda items yet.</div>
      )}
      {items.map((it, i) => (
        <div key={it.id} style={rowStyle}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: 'var(--color-primary-bg)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
            {i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{it.title}</div>
            {it.duration_minutes != null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{it.duration_minutes} min</div>
            )}
          </div>
          <button onClick={() => remove(it.id)} style={iconBtnStyle}><Trash2 size={13} /></button>
        </div>
      ))}
      {adding && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <input value={title} onChange={e => { setTitle(e.target.value); if (err) setErr(null); }} placeholder="Topic *" required aria-required="true" style={{ ...inputStyle, flex: 1 }} autoFocus />
          <select value={duration} onChange={e => setDuration(e.target.value)} style={{ ...inputStyle, width: 90 }}>
            <option value="">min</option>
            {AGENDA_DURATIONS.map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={add}>Add</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>×</button>
        </div>
      )}
    </SectionCard>
  );
}

// ── Participants ─────────────────────────────────────────

// Per-meeting roles + their default permission presets (mirror of the backend
// app/services/meeting_access.py — used only to preview defaults in the invite form).
const PARTICIPANT_ROLES = [
  { value: 'host',         label: 'Host (full control)' },
  { value: 'moderator',    label: 'Moderator' },
  { value: 'panel_member', label: 'Panel Member (can speak)' },
  { value: 'participant',  label: 'Participant (chat only)' },
  { value: 'observer',     label: 'Observer (view only)' },
];
const ROLE_SHORT = {
  host: 'Host', moderator: 'Moderator', panel_member: 'Panel',
  participant: 'Participant', observer: 'Observer',
};
const ROLE_BADGE = {
  host: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-text)' },
  moderator: { bg: 'var(--color-violet-bg)', fg: 'var(--color-violet)' },
  panel_member: { bg: 'var(--color-info-bg)', fg: 'var(--color-info)' },
  participant: { bg: 'var(--color-surface-raised)', fg: 'var(--color-text-secondary)' },
  observer: { bg: 'var(--color-surface-raised)', fg: 'var(--color-text-light)' },
};

const ALL_PERMISSIONS = [
  { key: 'speak',              label: 'Speak / unmute' },
  { key: 'chat',               label: 'Send chat' },
  { key: 'present',            label: 'Present / share screen' },
  { key: 'vote',               label: 'Answer polls' },
  { key: 'view_documents',     label: 'View documents' },
  { key: 'download_documents', label: 'Download documents' },
  { key: 'manage',             label: 'Host controls (manage)' },
];

// The invite list for a meeting. People are invited from the board's KOLs tab
// (a KOL IS the participant), so this has no add form. Removing someone tells
// the board (`onRemoved`) so they also come off the panel.
export function ParticipantsSection({ meetingId, title = 'Participants', reloadKey = 0, onRemoved }) {
  const [parts, setParts] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    try { setParts((await listMeetingParticipants(meetingId)).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId, reloadKey]);

  const joinLink = (p) => (p.join_token ? `${window.location.origin}/meeting/join/${p.join_token}` : null);

  const copyLink = async (p) => {
    const link = joinLink(p);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(c => (c === p.id ? null : c)), 1600);
    } catch {
      window.prompt('Copy this participant’s personal join link:', link);
    }
  };

  const regenerate = async (p) => {
    if (!window.confirm('Generate a new join link? The current link will stop working.')) return;
    try { await regenerateParticipantJoinToken(meetingId, p.id); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const resend = async (p) => {
    if (resendingId) return;
    setResendingId(p.id);
    try {
      await resendParticipantInvite(meetingId, p.id);
      load();
      alert(`Invite email re-sent to ${p.user_name || 'participant'}.`);
    } catch (e) {
      alert(e.response?.data?.detail || e.message || 'Could not resend the invite email');
    } finally {
      setResendingId(null);
    }
  };

  const changeRole = async (p, newRole) => {
    try {
      // Re-apply the new role's default permissions when the role changes.
      await updateMeetingParticipant(meetingId, p.id, { role: newRole, reset_permissions: true });
      load();
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const savePermissions = async (p, permissions) => {
    try {
      await updateMeetingParticipant(meetingId, p.id, { permissions });
      load();
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.user_name || 'this KOL'} from the board? Their personal login link stops working.`)) return;
    await removeMeetingParticipant(meetingId, p.id);
    load();
    onRemoved?.(p);
  };

  return (
    <SectionCard title={title}>
      {err && <div style={errStyle}>{err}</div>}
      <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', marginBottom: 6 }}>
        Selecting a KOL emails them their personal join link (separate login) and the meeting
        details automatically. Use the <Send size={11} style={{ verticalAlign: 'middle' }} /> button to resend.
      </div>
      {parts.length === 0 && (
        <div style={emptyStyle}>No KOLs invited yet. Select a KOL above to invite them.</div>
      )}
      {parts.map(p => {
        const badge = ROLE_BADGE[p.role] || ROLE_BADGE.participant;
        const isOpen = expandedId === p.id;
        return (
          <div key={p.id} style={{ borderBottom: '1px solid var(--color-border-light)', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: badge.bg, color: badge.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>
                {(p.user_name || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.hcp_id ? (
                    <a href={p.profile_path} target="_blank" rel="noreferrer"
                       title="Open KOL profile"
                       style={{ color: 'inherit', textDecoration: 'none' }}>
                      {p.user_name || `KOL #${p.hcp_id}`}
                    </a>
                  ) : (
                    p.user_name || (p.user_id ? `User #${p.user_id}` : `Contact #${p.participant_id}`)
                  )}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '1px 7px', borderRadius: 999, background: badge.bg, color: badge.fg, fontWeight: 600 }}>
                    {ROLE_SHORT[p.role] || p.role}
                  </span>
                  <span>{p.invite_status}</span>
                  {p.can_speak && <span>• can speak</span>}
                  {p.joined_at && <span style={{ color: 'var(--color-success)' }}>• joined</span>}
                </div>
              </div>
              <button onClick={() => resend(p)} title="Resend invite email (personal login link)" style={iconBtnStyle} disabled={resendingId === p.id || !p.join_token}>
                <Send size={13} />
              </button>
              <button onClick={() => copyLink(p)} title="Copy personal join link" style={iconBtnStyle} disabled={!p.join_token}>
                {copiedId === p.id ? <CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} />}
              </button>
              <button onClick={() => setExpandedId(isOpen ? null : p.id)} title="Role & permissions" style={iconBtnStyle}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <button onClick={() => remove(p)} title="Remove" style={iconBtnStyle}><Trash2 size={13} /></button>
            </div>

            {isOpen && (
              <ParticipantSettings
                p={p}
                joinLink={joinLink(p)}
                onChangeRole={(r) => changeRole(p, r)}
                onSavePermissions={(perms) => savePermissions(p, perms)}
                onRegenerate={() => regenerate(p)}
                onCopy={() => copyLink(p)}
                copied={copiedId === p.id}
              />
            )}
          </div>
        );
      })}
    </SectionCard>
  );
}

// Expandable per-participant role + permissions + personal join link editor
function ParticipantSettings({ p, joinLink, onChangeRole, onSavePermissions, onRegenerate, onCopy, copied }) {
  const [perms, setPerms] = useState(p.permissions || []);
  const [dirty, setDirty] = useState(false);

  // Keep local checkboxes in sync if the participant reloads (e.g. role change resets perms)
  useEffect(() => { setPerms(p.permissions || []); setDirty(false); }, [p.permissions]);

  const toggle = (key) => {
    setPerms(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
    setDirty(true);
  };

  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--color-bg)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Personal join link */}
      <div>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Link2 size={12} /> Personal join link (separate login)
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input readOnly value={joinLink || '— no link —'} onFocus={e => e.target.select()} style={{ ...inputStyle, fontSize: '0.78rem', flex: 1, background: 'var(--color-surface)' }} />
          <button className="btn btn-sm btn-ghost" onClick={onCopy} title="Copy link" disabled={!joinLink}>
            {copied ? <CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} />}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onRegenerate} title="Regenerate link">
            <RefreshCw size={13} />
          </button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', marginTop: 4 }}>
          Share this unique link with {p.user_name || 'this participant'}; it identifies them individually and applies their role/permissions.
        </div>
      </div>

      {/* Role */}
      <div>
        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 6 }}>
          Role
        </label>
        <select value={p.role} onChange={e => onChangeRole(e.target.value)} style={inputStyle}>
          {PARTICIPANT_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', marginTop: 4 }}>
          Changing the role resets permissions to that role’s defaults.
        </div>
      </div>

      {/* Permissions */}
      <div>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Shield size={12} /> Permissions
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '4px 12px' }}>
          {ALL_PERMISSIONS.map(perm => (
            <label key={perm.key} style={{ fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={perms.includes(perm.key)} onChange={() => toggle(perm.key)} />
              {perm.label}
            </label>
          ))}
        </div>
        {dirty && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => onSavePermissions(perms)}>Save permissions</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setPerms(p.permissions || []); setDirty(false); }}>Reset</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Documents ────────────────────────────────────────────

// Stage-specific document categories (matches the agreed Document-Upload-by-Stage list).
const CATEGORIES_BY_PHASE = {
  pre:    ['slide_deck', 'pre_read', 'survey_draft', 'approved_materials', 'other'],
  during: ['agenda', 'moderator_guide', 'poll_questions', 'meeting_notes', 'transcript', 'other'],
  post:   ['draft_report', 'final_report', 'analysis', 'survey_results', 'client_feedback', 'other'],
};
const CATEGORY_LABELS = {
  slide_deck: 'Slide deck', pre_read: 'Pre-read material', survey_draft: 'Survey draft', approved_materials: 'Approved materials',
  agenda: 'Agenda', moderator_guide: 'Moderator guide', poll_questions: 'Live poll questions', meeting_notes: 'Meeting notes', transcript: 'Transcript file',
  draft_report: 'Draft report', final_report: 'Final report', analysis: 'Analysis file', survey_results: 'Survey results', client_feedback: 'Client feedback',
  other: 'Other',
  // legacy values kept for older documents
  ppt: 'Slides', draft: 'Draft', cv: 'CV', reference: 'Reference', report: 'Report', questionnaire: 'Questionnaire', minutes: 'Minutes', manuscript: 'Manuscript',
};
const catLabel = (c) => CATEGORY_LABELS[c] || c;

const APPROVAL_BADGE = {
  pending: { label: 'Pending', bg: 'var(--color-surface-raised)', fg: 'var(--color-text-secondary)' },
  approved: { label: 'Approved', bg: 'var(--color-success-bg)', fg: 'var(--color-success-text)' },
  rejected: { label: 'Rejected', bg: 'var(--color-error-bg)', fg: 'var(--color-error-text)' },
};

function DocumentsSection({ meetingId, phase, title }) {
  const [docs, setDocs] = useState([]);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [copiedDocId, setCopiedDocId] = useState(null);
  // Sections — the folders documents live in ("Section ABC" and its files),
  // which is how the client and expert portals group them. NOT sessions (parts
  // of the meeting, which hold no documents) and NOT the agenda (the timed
  // running order, published as such).
  const [sections, setSections] = useState([]);
  // The organizer creates these too, and they are a separate list from the
  // sections — never mixed into the same dropdown.
  const [sessions, setSessions] = useState([]);
  // What the NEXT upload is filed under, one per list.
  const [filing, setFiling] = useState({ section: '', session: '' });

  const load = async () => {
    try { setDocs((await listMeetingDocuments(meetingId, { phase })).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId, phase]);
  const loadHeadings = useCallback(async () => {
    const [sec, ses] = await Promise.allSettled([
      listMeetingSections(meetingId, 'section'),
      listMeetingSections(meetingId, 'session'),
    ]);
    // allSettled: one list failing must not empty the other's picker.
    if (sec.status === 'fulfilled') setSections(sec.value.data || []);
    if (ses.status === 'fulfilled') setSessions(ses.value.data || []);
  }, [meetingId]);
  useEffect(() => { loadHeadings(); }, [loadHeadings]);

  // Re-file one document. `kind` is 'section' or 'session' — the same call with
  // a different field, because the two behave identically.
  const refile = async (d, kind, value) => {
    try {
      await updateMeetingDocument(meetingId, d.id, { [`${kind}_id`]: value ? Number(value) : null });
      load();
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  // Deleting a heading never deletes its documents — they become unfiled — so
  // the confirm says so rather than implying the files go with it.
  const removeHeading = async (kind, id, title, documentCount) => {
    const note = documentCount
      ? `\n\n${documentCount} document${documentCount === 1 ? '' : 's'} filed under it will stay — ` +
        `they just won't have a ${kind} any more.`
      : '';
    if (!window.confirm(`Delete the ${kind} "${title}"?${note}`)) return;
    try {
      await deleteMeetingSection(meetingId, id);
      setFiling(f => (String(f[kind]) === String(id) ? { ...f, [kind]: '' } : f));
      await loadHeadings();
      load();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  // Created from here, so filing a document never means leaving to make the
  // heading first. The new one becomes what the next upload is filed under.
  const addHeading = async (kind, title) => {
    const name = (title || '').trim();
    if (!name) return;
    try {
      const r = await createMeetingSection(meetingId, { title: name }, kind);
      await loadHeadings();
      setFiling(f => ({ ...f, [kind]: String(r.data.id) }));
    } catch (e) { setErr(e.response?.data?.detail || e.message); throw e; }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      await uploadMeetingDocument(meetingId, {
        file, phase, category: 'other', title: file.name,
        sectionId: filing.section ? Number(filing.section) : null,
        sessionId: filing.session ? Number(filing.session) : null,
      });
      load();
    } catch (e2) { setErr(e2.response?.data?.detail || e2.message); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const toggleEnabled = async (d) => {
    try { await updateMeetingDocument(meetingId, d.id, { is_enabled: !d.is_enabled }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const toggleComments = async (d) => {
    try { await updateMeetingDocument(meetingId, d.id, { allow_comments: !d.allow_comments }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const toggleClientVisible = async (d) => {
    try { await updateMeetingDocument(meetingId, d.id, { client_visible: !d.client_visible }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const toggleKolVisible = async (d) => {
    try { await updateMeetingDocument(meetingId, d.id, { kol_visible: !d.kol_visible }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const setCategory = async (d, category) => {
    try { await updateMeetingDocument(meetingId, d.id, { category }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const setApproval = async (d, approval_status) => {
    try { await updateMeetingDocument(meetingId, d.id, { approval_status }); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const preview = previewDoc;
  // Stable per document: the modal fetches in an effect keyed on this.
  const fetchPreviewBlob = useCallback(
    () => previewMeetingDocument(meetingId, previewDoc.id),
    [meetingId, previewDoc],
  );

  const download = async (d) => {
    try {
      const r = await downloadMeetingDocument(meetingId, d.id);
      const blob = r.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = d.title; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete "${d.title}"?`)) return;
    await deleteMeetingDocument(meetingId, d.id);
    load();
  };

  // Copy a public, no-login link that opens this document directly. Mints the
  // token on first use (idempotent server-side) and reuses it after that.
  const copyPublicLink = async (d) => {
    try {
      let token = d.public_token;
      if (!token) {
        const r = await createDocumentShareLink(meetingId, d.id);
        token = r.data.public_token;
        setDocs(prev => prev.map(x => (x.id === d.id ? { ...x, public_token: token } : x)));
      }
      const url = publicDocumentUrl(token);
      try {
        await navigator.clipboard.writeText(url);
        setCopiedDocId(d.id);
        setTimeout(() => setCopiedDocId(c => (c === d.id ? null : c)), 1600);
      } catch {
        window.prompt('Copy this public document link:', url);
      }
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  // Revoke the public link — the shared URL stops working immediately.
  const revokePublicLink = async (d) => {
    if (!window.confirm(`Revoke the public link for "${d.title}"? Anyone who already has the link will lose access.`)) return;
    try {
      await revokeDocumentShareLink(meetingId, d.id);
      setDocs(prev => prev.map(x => (x.id === d.id ? { ...x, public_token: null } : x)));
    } catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  return (
    // Full width of the phase grid: the title, the section picker, Upload and
    // the new-section box are one row of controls, and in a half-width card
    // they stacked into four.
    <div className="card" style={{ padding: 18, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h4>
        <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
          <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
          <input type="file" hidden onChange={onFile} disabled={uploading} />
        </label>
      </div>

      {/* Where the NEXT upload is filed. Two independent lists, each with its
          own "add" — and each labelled, because an unlabelled dropdown reading
          "No section" told you nothing about what the other one was for. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10,
        padding: 12, marginBottom: 12, borderRadius: 8,
        background: 'var(--color-bg)', border: '1px solid var(--color-border-light)',
      }}>
        <FilingPicker
          label="Section" hint="A folder of documents, e.g. Section ABC"
          options={sections} value={filing.section}
          onChange={v => setFiling(f => ({ ...f, section: v }))}
          onAdd={t => addHeading('section', t)} placeholder="New section name"
          onDelete={(o) => removeHeading('section', o.id, o.title, o.document_count)} />
        <FilingPicker
          label="Session" hint="A part of the programme, e.g. Session 1"
          options={sessions} value={filing.session}
          onChange={v => setFiling(f => ({ ...f, session: v }))}
          onAdd={t => addHeading('session', t)} placeholder="New session name"
          onDelete={(o) => removeHeading('session', o.id, o.title, o.document_count)} />
      </div>

      {err && <div style={errStyle}>{err}</div>}
      {docs.length === 0 ? (
        <div style={emptyStyle}>No documents in this phase.</div>
      ) : docs.map(d => (
        <div key={d.id} style={{ ...rowStyle, opacity: d.is_enabled ? 1 : 0.55, flexWrap: 'wrap' }}>
          <FileText size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.title}
              {d.version > 1 && <span style={{ marginLeft: 6, fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-primary)' }}>v{d.version}</span>}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select value={(CATEGORIES_BY_PHASE[phase] || []).includes(d.category) ? d.category : d.category}
                onChange={e => setCategory(d, e.target.value)} style={{ ...inputStyle, padding: '1px 4px', fontSize: '0.72rem', width: 'auto', height: 22 }}>
                {[...new Set([...(CATEGORIES_BY_PHASE[phase] || []), d.category])].map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
              <select value={d.approval_status || 'pending'} onChange={e => setApproval(d, e.target.value)}
                title="Approval status"
                style={{ ...inputStyle, padding: '1px 4px', fontSize: '0.72rem', width: 'auto', height: 22,
                  color: APPROVAL_BADGE[d.approval_status]?.fg, fontWeight: 600 }}>
                {Object.keys(APPROVAL_BADGE).map(s => <option key={s} value={s}>{APPROVAL_BADGE[s].label}</option>)}
              </select>
              {sections.length > 0 && (
                <select value={d.section_id || ''} onChange={e => refile(d, 'section', e.target.value)}
                  title="Section this document is filed in"
                  style={{ ...inputStyle, padding: '1px 4px', fontSize: '0.72rem', width: 'auto', height: 22 }}>
                  <option value="">No section</option>
                  {sections.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              )}
              {sessions.length > 0 && (
                <select value={d.session_id || ''} onChange={e => refile(d, 'session', e.target.value)}
                  title="Session this document belongs to"
                  style={{ ...inputStyle, padding: '1px 4px', fontSize: '0.72rem', width: 'auto', height: 22 }}>
                  <option value="">No session</option>
                  {sessions.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              )}
              {d.size_bytes != null && <span>{Math.round(d.size_bytes / 1024)} KB</span>}
              {d.comment_count > 0 && <span><MessageSquare size={10} /> {d.comment_count}</span>}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-light)', marginTop: 2 }}>
              {d.uploader_name ? `By ${d.uploader_name}` : 'Uploaded'} · {new Date(d.created_at).toLocaleString()}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
            <button onClick={() => toggleEnabled(d)} title={d.is_enabled ? 'Disable' : 'Enable'} style={iconBtnStyle}>
              {d.is_enabled ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button onClick={() => toggleComments(d)} title={d.allow_comments ? 'Lock comments' : 'Allow comments'} style={iconBtnStyle}>
              <MessageSquare size={13} style={{ color: d.allow_comments ? 'var(--color-success)' : undefined }} />
            </button>
            <button onClick={() => toggleClientVisible(d)} title={d.client_visible ? 'Hide from client' : 'Share with client for review'} style={iconBtnStyle}>
              <UserCheck size={13} style={{ color: d.client_visible ? 'var(--color-primary)' : undefined }} />
            </button>
            <button onClick={() => toggleKolVisible(d)}
              title={d.kol_visible ? 'Shared with KOLs/advisors — click to unshare' : 'Share with KOLs/advisors: shows it in their meeting portal (Materials) and emails them'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999,
                border: `1px solid ${d.kol_visible ? 'var(--color-info)' : 'var(--color-border)'}`,
                background: d.kol_visible ? 'var(--color-info)' : 'var(--color-surface)',
                color: d.kol_visible ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              <Users size={12} /> {d.kol_visible ? 'Shared' : 'KOLs'}
            </button>
            <button onClick={() => copyPublicLink(d)}
              title={d.public_token ? 'Copy public link (opens without login)' : 'Create & copy public link (opens without login)'}
              style={iconBtnStyle}>
              {copiedDocId === d.id ? <CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> : <Link2 size={13} style={{ color: d.public_token ? 'var(--color-primary)' : undefined }} />}
            </button>
            {d.public_token && (
              <button onClick={() => revokePublicLink(d)} title="Revoke public link" style={iconBtnStyle}>
                <Link2Off size={13} style={{ color: 'var(--color-error)' }} />
              </button>
            )}
            {d.preview_kind && (
              <button onClick={() => setPreviewDoc(d)} title="Preview in the browser" style={iconBtnStyle}><Maximize2 size={13} /></button>
            )}
            <button onClick={() => download(d)} title="Download" style={iconBtnStyle}><Download size={13} /></button>
            <button onClick={() => remove(d)} title="Delete" style={iconBtnStyle}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
      {preview && (
        <DocumentPreviewModal
          doc={preview} kind={preview.preview_kind}
          fetchBlob={fetchPreviewBlob}
          onClose={() => setPreviewDoc(null)}
          onDownload={() => download(preview)}
        />
      )}
    </div>
  );
}

/** One labelled filing field: a dropdown plus its own "+ New" box.
 *  Sections and sessions are two separate lists that behave identically, so
 *  they share this rather than being written twice and drifting apart. */
function FilingPicker({ label, hint, options, value, onChange, onAdd, onDelete, placeholder }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = options.find(o => String(o.id) === String(value)) || null;

  const submit = async () => {
    // Enter and the button both land here, so without the guard one quick
    // "type, Enter, click" makes two headings with the same name.
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await onAdd(title); setTitle(''); setAdding(false); }
    catch { /* the card shows the error */ }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                    color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ ...inputStyle, flex: 1, height: 28, fontSize: '0.78rem' }}>
          <option value="">No {label.toLowerCase()}</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
        <button className="btn btn-sm btn-ghost" onClick={() => setAdding(a => !a)}
          title={`Create a ${label.toLowerCase()}`} style={{ whiteSpace: 'nowrap' }}>
          <Plus size={12} /> New
        </button>
        {/* Deletes whichever one is selected — there was no way to remove a
            heading at all, so a typo or a test entry stayed in the list. */}
        {selected && (
          <button className="btn btn-sm btn-ghost" onClick={() => onDelete(selected)}
            title={`Delete "${selected.title}"`} style={{ color: 'var(--color-error)' }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {adding ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
            placeholder={placeholder}
            style={{ ...inputStyle, flex: 1, height: 28, fontSize: '0.78rem' }} />
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !title.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

// ── Recording ────────────────────────────────────────────

function RecordingSection({ meetingId, zoomMeetingId, onSynced }) {
  const [recs, setRecs] = useState([]);
  const [err, setErr] = useState(null);
  // Recordings are organizer-only (see backend meeting_transcripts.py). A 403
  // means this user isn't the organizer, so hide the card entirely rather than
  // advertising that a recording exists.
  const [forbidden, setForbidden] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const load = async () => {
    try { setRecs((await getMeetingRecording(meetingId)).data || []); }
    catch (e) {
      if (e.response?.status === 403) setForbidden(true);
      else setErr(e.response?.data?.detail || e.message);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      await uploadMeetingRecording(meetingId, { file });
      load();
    } catch (e2) { setErr(e2.response?.data?.detail || e2.message); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const sync = async () => {
    setSyncing(true); setErr(null); setSyncMsg(null);
    try {
      const r = await syncMeetingFromZoom(meetingId);
      const parts = [];
      if (r.data?.recording_added) parts.push('recording');
      if (r.data?.transcript_updated) parts.push('transcript');
      setSyncMsg(parts.length ? `Pulled: ${parts.join(' + ')}.` : (r.data?.detail || 'Nothing new yet.'));
      load();
      if (parts.length) onSynced?.();
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message);
    } finally {
      setSyncing(false);
    }
  };

  if (forbidden) return null;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Recording</h4>
        <div style={{ display: 'flex', gap: 6 }}>
          {zoomMeetingId && (
            <button className="btn btn-sm btn-outline" onClick={sync} disabled={syncing} title="Pull latest recording + transcript from Zoom">
              {syncing ? 'Syncing…' : 'Sync from Zoom'}
            </button>
          )}
          <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
            <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
            <input type="file" accept="video/*,audio/*" hidden onChange={onFile} disabled={uploading} />
          </label>
        </div>
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {syncMsg && <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-text)', padding: 8, borderRadius: 6, fontSize: '0.82rem', marginBottom: 8 }}>{syncMsg}</div>}
      {recs.length === 0 ? (
        <div style={emptyStyle}>
          {zoomMeetingId
            ? 'No recording yet. Click "Sync from Zoom" once the cloud recording finishes processing.'
            : 'No recording uploaded yet. Auto-create the meeting via Zoom (in MABM Admin) for automatic recording sync.'}
        </div>
      ) : recs.map(r => (
        <RecordingRow key={r.id} meetingId={meetingId} rec={r}
          onDeleted={(id) => setRecs((prev) => prev.filter((x) => x.id !== id))} />
      ))}
    </div>
  );
}

// ── Transcript ───────────────────────────────────────────

function TranscriptSection({ meetingId }) {
  const [transcript, setTranscript] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(null);
  const [missing, setMissing] = useState(false);
  // Organizer-only, same as the recording above — 403 hides the card.
  const [forbidden, setForbidden] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setErr(null); setMissing(false);
    try {
      const r = await getMeetingTranscript(meetingId);
      setTranscript(r.data);
    } catch (e) {
      if (e.response?.status === 404) { setMissing(true); setTranscript(null); }
      else if (e.response?.status === 403) setForbidden(true);
      else setErr(e.response?.data?.detail || e.message);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId]);

  // Speech-to-text over the latest recording. Slow (extract + upload + Whisper),
  // so the button reports progress rather than looking hung.
  const generate = async () => {
    setGenerating(true); setErr(null);
    try {
      const r = await generateMeetingTranscript(meetingId);
      setTranscript(r.data); setMissing(false);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not generate the transcript.');
    } finally { setGenerating(false); }
  };

  const startDraft = async () => {
    try {
      await createMeetingTranscript(meetingId, draft || '(empty draft)');
      setDraft('');
      load();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  const saveEdit = async () => {
    try {
      await editMeetingTranscript(meetingId, draft);
      setEditing(false);
      load();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  const finalize = async () => {
    if (!window.confirm('Finalize and share the transcript with all participants? This cannot be undone.')) return;
    try { await finalizeMeetingTranscript(meetingId); load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  const text = transcript?.edited_text ?? transcript?.raw_text ?? '';
  const isFinalized = transcript?.status === 'finalized' || transcript?.status === 'shared';

  if (forbidden) return null;

  return (
    <div className="card" style={{ padding: 18, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Transcript</h4>
        {transcript && (
          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999, background: isFinalized ? 'var(--color-success-bg)' : 'var(--color-warning-bg)', color: isFinalized ? 'var(--color-success-text)' : 'var(--color-warning-text)', fontWeight: 600 }}>
            {transcript.status}
          </span>
        )}
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {missing ? (
        <div>
          <div style={{ ...emptyStyle, marginBottom: 10 }}>
            No transcript yet. Generate one from the meeting recording, or paste raw text below.
          </div>
          <button className="btn btn-sm btn-primary" onClick={generate} disabled={generating} style={{ marginBottom: 12 }}>
            <FileText size={13} /> {generating ? 'Transcribing… this can take a few minutes' : 'Generate from recording'}
          </button>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} placeholder="Paste raw transcript…" style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={startDraft}>Save Draft</button>
          </div>
        </div>
      ) : transcript && (
        <>
          {editing ? (
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={12} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
          ) : (
            <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', padding: 10, background: 'var(--color-bg)', borderRadius: 6 }}>
              {text || <em style={{ color: 'var(--color-text-light)' }}>(empty)</em>}
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            {!isFinalized && !editing && (
              <button className="btn btn-sm btn-ghost" onClick={() => { setDraft(text); setEditing(true); }}>
                <Edit3 size={12} /> Edit
              </button>
            )}
            {editing && (
              <>
                <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              </>
            )}
            {!isFinalized && !editing && (
              <button className="btn btn-sm btn-outline" onClick={finalize}>
                <CheckCircle size={12} /> Finalize & Share
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Surveys (linked to meeting; phase: pre | post) ───────

function SurveysSection({ meetingId, phase, title }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [linking, setLinking] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setLinks((await listMeetingSurveys(meetingId, { phase })).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId, phase]);

  const unlink = async (linkId) => {
    if (!window.confirm('Unlink this survey from the meeting?')) return;
    try { await unlinkMeetingSurvey(meetingId, linkId); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const publicUrl = (token) => `${window.location.origin}/survey/${token}`;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h4>
        <button className="btn btn-sm btn-primary" onClick={() => setLinking(true)}>
          <Plus size={12} /> Link survey
        </button>
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : links.length === 0 ? (
        <div style={emptyStyle}>
          No surveys linked. Reuses the existing /surveys module — create one there first.
        </div>
      ) : links.map(l => (
        <div key={l.id} style={rowStyle}>
          <ClipboardList size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.title || `Survey #${l.survey_id}`}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
              {l.status} • {l.response_count} response{l.response_count === 1 ? '' : 's'}
            </div>
          </div>
          {l.token && (
            <a href={publicUrl(l.token)} target="_blank" rel="noopener noreferrer" title="Open public survey link" style={iconBtnStyle}>
              <ExternalLink size={13} />
            </a>
          )}
          <button onClick={() => unlink(l.id)} title="Unlink" style={iconBtnStyle}><Trash2 size={13} /></button>
        </div>
      ))}
      {linking && (
        <LinkPickerModal
          kind="survey"
          phase={phase}
          existingIds={links.map(l => l.survey_id)}
          onClose={() => setLinking(false)}
          onPicked={async (id) => {
            try { await linkMeetingSurvey(meetingId, id, phase); setLinking(false); load(); }
            catch (e) { alert(e.response?.data?.detail || e.message); }
          }}
        />
      )}
    </div>
  );
}

// ── Polls (live, linked to meeting) ──────────────────────

function PollsSection({ meetingId }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [linking, setLinking] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setLinks((await listMeetingPolls(meetingId)).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId]);

  const unlink = async (linkId) => {
    if (!window.confirm('Unlink this poll from the meeting?')) return;
    try { await unlinkMeetingPoll(meetingId, linkId); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const publicUrl = (token) => `${window.location.origin}/poll/${token}`;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Live Polls</h4>
        <button className="btn btn-sm btn-primary" onClick={() => setLinking(true)}>
          <Plus size={12} /> Link poll
        </button>
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {loading ? (
        <div style={emptyStyle}>Loading…</div>
      ) : links.length === 0 ? (
        <div style={emptyStyle}>
          No polls linked yet. Create one in the /polls page, then link it here.
        </div>
      ) : links.map(l => (
        <div key={l.id} style={rowStyle}>
          <BarChart3 size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.title || `Poll #${l.poll_id}`}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
              {l.status} {l.vote_count != null && `• ${l.vote_count} vote${l.vote_count === 1 ? '' : 's'}`}
            </div>
          </div>
          {l.token && (
            <a href={publicUrl(l.token)} target="_blank" rel="noopener noreferrer" title="Open public poll link" style={iconBtnStyle}>
              <ExternalLink size={13} />
            </a>
          )}
          <button onClick={() => unlink(l.id)} title="Unlink" style={iconBtnStyle}><Trash2 size={13} /></button>
        </div>
      ))}
      {linking && (
        <LinkPickerModal
          kind="poll"
          existingIds={links.map(l => l.poll_id)}
          onClose={() => setLinking(false)}
          onPicked={async (id) => {
            try { await linkMeetingPoll(meetingId, id); setLinking(false); load(); }
            catch (e) { alert(e.response?.data?.detail || e.message); }
          }}
        />
      )}
    </div>
  );
}

// ── Survey/Poll picker modal ─────────────────────────────

function LinkPickerModal({ kind, phase, existingIds = [], onClose, onPicked }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = kind === 'survey' ? await listSurveys() : await listPolls();
        setItems(r.data || []);
      } catch (e) {
        setErr(e.response?.data?.detail || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [kind]);

  const available = items.filter(it => {
    if (existingIds.includes(it.id)) return false;
    if ((it.status || '').toLowerCase() !== 'active') return false;
    return true;
  });
  const label = kind === 'survey' ? 'Survey' : 'Poll';
  const route = kind === 'survey' ? '/surveys' : '/polls';

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: 460, width: '100%', padding: 0, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--color-border-light)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Link {label}{phase ? ` (${phase})` : ''}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
          {loading ? <div style={emptyStyle}>Loading…</div>
            : err ? <div style={errStyle}>{err}</div>
            : items.length === 0 ? (
              <div style={emptyStyle}>
                You haven't created any {label.toLowerCase()}s yet. Open <a href={route}>{route}</a> first.
              </div>
            ) : available.length === 0 ? (
              <div style={emptyStyle}>All your {label.toLowerCase()}s are already linked.</div>
            ) : available.map(it => (
              <button key={it.id} onClick={() => { setPicking(it.id); onPicked(it.id); }}
                disabled={picking === it.id}
                style={{ ...rowStyle, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{it.title}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
                    {it.status}
                    {it.response_count != null && ` • ${it.response_count} responses`}
                    {it.vote_count != null && ` • ${it.vote_count} votes`}
                  </div>
                </div>
                <Plus size={14} style={{ color: 'var(--color-primary)' }} />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Minutes of Meeting ───────────────────────────────────

const MINUTES_STATUS_COLORS = { draft: 'var(--color-warning)', shared: 'var(--color-info)', finalized: 'var(--color-success)' };

function MinutesSection({ meetingId }) {
  const [minutes, setMinutes] = useState(null);
  const [missing, setMissing] = useState(false);
  const [comments, setComments] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [seedFromTranscript, setSeedFromTranscript] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr(null); setMissing(false);
    try {
      const r = await getMeetingMinutes(meetingId);
      setMinutes(r.data);
      const cr = await listMeetingMinutesComments(meetingId);
      setComments(cr.data || []);
    } catch (e) {
      if (e.response?.status === 404) { setMissing(true); setMinutes(null); }
      else setErr(e.response?.data?.detail || e.message);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId]);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      await createMeetingMinutes(meetingId, { seed_from_transcript: seedFromTranscript, draft_text: '' });
      load();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const saveEdit = async () => {
    setBusy(true); setErr(null);
    try { await editMeetingMinutes(meetingId, draft); setEditing(false); load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const share = async () => {
    if (!window.confirm('Share these minutes with all participants and open the comment thread?')) return;
    setBusy(true); setErr(null);
    try { await shareMeetingMinutes(meetingId); load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!window.confirm('Finalize the minutes? This freezes the final text and cannot be undone.')) return;
    setBusy(true); setErr(null);
    try { await finalizeMeetingMinutes(meetingId); load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try { await addMeetingMinutesComment(meetingId, newComment.trim()); setNewComment(''); load(); }
    catch (e2) { setErr(e2.response?.data?.detail || e2.message); }
  };

  const removeComment = async (id) => {
    if (!window.confirm('Delete this comment?')) return;
    try { await deleteMeetingMinutesComment(meetingId, id); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  const text = minutes?.final_text ?? minutes?.draft_text ?? '';
  const status = minutes?.status;
  const canEdit = status !== 'finalized';

  return (
    <div className="card" style={{ padding: 18, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Minutes of Meeting</h4>
        {minutes && (
          <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, background: `${MINUTES_STATUS_COLORS[status]}1A`, color: MINUTES_STATUS_COLORS[status] }}>
            {status}
          </span>
        )}
      </div>
      {err && <div style={errStyle}>{err}</div>}

      {missing ? (
        <div>
          <div style={{ ...emptyStyle, marginBottom: 10 }}>
            No minutes drafted yet. Optionally seed from the meeting transcript.
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.83rem', marginBottom: 10 }}>
            <input type="checkbox" checked={seedFromTranscript} onChange={e => setSeedFromTranscript(e.target.checked)} />
            Pre-fill from current transcript text
          </label>
          <button className="btn btn-sm btn-primary" onClick={create} disabled={busy}>
            <Plus size={12} /> Create draft
          </button>
        </div>
      ) : minutes && (
        <>
          {editing ? (
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={12} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
          ) : (
            <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', padding: 10, background: 'var(--color-bg)', borderRadius: 6 }}>
              {text || <em style={{ color: 'var(--color-text-light)' }}>(empty)</em>}
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canEdit && !editing && (
              <button className="btn btn-sm btn-ghost" onClick={() => { setDraft(text); setEditing(true); }}>
                <Edit3 size={12} /> Edit
              </button>
            )}
            {editing && (
              <>
                <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={busy}>Save</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              </>
            )}
            {status === 'draft' && !editing && (
              <button className="btn btn-sm btn-outline" onClick={share} disabled={busy}>
                <Send size={12} /> Share with participants
              </button>
            )}
            {status === 'shared' && !editing && (
              <button className="btn btn-sm btn-outline" onClick={finalize} disabled={busy}>
                <CheckCircle size={12} /> Finalize
              </button>
            )}
          </div>

          {/* Comments */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border-light)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Comments ({comments.length})
            </div>
            {comments.length === 0 ? (
              <div style={emptyStyle}>No comments yet.</div>
            ) : comments.map(c => (
              <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-light)', display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                    <strong>{c.user_name || `User #${c.user_id}`}</strong> • {new Date(c.created_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
                <button onClick={() => removeComment(c.id)} style={iconBtnStyle}><Trash2 size={12} /></button>
              </div>
            ))}
            {status === 'shared' && (
              <form onSubmit={submitComment} style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a comment…" style={{ ...inputStyle, flex: 1 }} />
                <button type="submit" className="btn btn-sm btn-primary">Post</button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Manuscripts ──────────────────────────────────────────

const MANUSCRIPT_STATUSES = [
  'draft', 'review', 'finalized', 'submitted', 'under_review',
  'accepted', 'rejected', 'resubmitted', 'published',
];
const MANUSCRIPT_STATUS_COLORS = {
  draft: 'var(--color-text-light)', review: 'var(--color-warning)', finalized: 'var(--color-info)',
  submitted: 'var(--color-primary)', under_review: 'var(--color-violet)',
  accepted: 'var(--color-success)', rejected: 'var(--color-error)',
  resubmitted: 'var(--color-warning)', published: 'var(--color-success)',
};

function ManuscriptsSection({ meetingId }) {
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newJournal, setNewJournal] = useState('');
  const [err, setErr] = useState(null);

  const load = async () => {
    setErr(null);
    try { setItems((await listMeetingManuscripts(meetingId)).data || []); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [meetingId]);

  const create = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await createManuscript(meetingId, { title: newTitle.trim(), journal_name: newJournal.trim() || null });
      setNewTitle(''); setNewJournal(''); setCreating(false);
      load();
    } catch (e2) { setErr(e2.response?.data?.detail || e2.message); }
  };

  const remove = async (m) => {
    if (!window.confirm(`Delete manuscript "${m.title}"?`)) return;
    try { await deleteManuscript(m.id); load(); }
    catch (e) { alert(e.response?.data?.detail || e.message); }
  };

  return (
    <div className="card" style={{ padding: 18, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Manuscripts</h4>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
          <Plus size={12} /> New manuscript
        </button>
      </div>
      {err && <div style={errStyle}>{err}</div>}

      {creating && (
        <form onSubmit={create} style={{ marginBottom: 12, padding: 12, background: 'var(--color-bg)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Manuscript title" style={inputStyle} autoFocus />
          <input value={newJournal} onChange={e => setNewJournal(e.target.value)} placeholder="Target journal (optional)" style={inputStyle} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary">Create</button>
          </div>
        </form>
      )}

      {items.length === 0 && !creating ? (
        <div style={emptyStyle}>
          <BookOpen size={20} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--color-text-light)' }} />
          No manuscripts yet. Track expert opinions, consensus papers, or guidelines from this meeting.
        </div>
      ) : items.map(m => (
        <ManuscriptRow key={m.id} m={m} onDelete={() => remove(m)} onChange={load} />
      ))}
    </div>
  );
}

function ManuscriptRow({ m, onChange, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [newStatus, setNewStatus] = useState(m.status);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [journal, setJournal] = useState(m.journal_name || '');
  const [publishedUrl, setPublishedUrl] = useState(m.published_url || '');
  const [doi, setDoi] = useState(m.doi || '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const c = MANUSCRIPT_STATUS_COLORS[m.status] || 'var(--color-text-light)';

  const transition = async () => {
    setBusy(true); setErr(null);
    try { await transitionManuscriptStatus(m.id, newStatus, statusNote || null); setStatusNote(''); onChange(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await updateManuscript(m.id, {
        title, journal_name: journal || null,
        published_url: publishedUrl || null, doi: doi || null,
      });
      setEditing(false); onChange();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    try { await addManuscriptComment(m.id, comment.trim()); setComment(''); onChange(); }
    catch (e2) { setErr(e2.response?.data?.detail || e2.message); }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--color-border-light)', padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BookOpen size={16} style={{ color: c, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{m.title}</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
            {m.journal_name && <>{m.journal_name} • </>}
            {m.comment_count} comment{m.comment_count === 1 ? '' : 's'}
            {m.last_status_email_at && <> • last ping {new Date(m.last_status_email_at).toLocaleDateString()}</>}
          </div>
        </div>
        <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: `${c}1A`, color: c }}>
          {m.status.replace(/_/g, ' ')}
        </span>
        <button onClick={() => setExpanded(v => !v)} style={iconBtnStyle}>{expanded ? '−' : '+'}</button>
        <button onClick={onDelete} style={iconBtnStyle}><Trash2 size={12} /></button>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--color-bg)', borderRadius: 6, fontSize: '0.85rem' }}>
          {err && <div style={errStyle}>{err}</div>}

          {/* Edit metadata */}
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="Title" />
              <input value={journal} onChange={e => setJournal(e.target.value)} style={inputStyle} placeholder="Journal" />
              <input value={publishedUrl} onChange={e => setPublishedUrl(e.target.value)} style={inputStyle} placeholder="Published URL (after publication)" />
              <input value={doi} onChange={e => setDoi(e.target.value)} style={inputStyle} placeholder="DOI" />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={save} className="btn btn-sm btn-primary" disabled={busy}>Save</button>
                <button onClick={() => setEditing(false)} className="btn btn-sm btn-ghost">Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 14, color: 'var(--color-text-secondary)', fontSize: '0.78rem' }}>
              {m.submitted_at && <span>Submitted: {new Date(m.submitted_at).toLocaleDateString()}</span>}
              {m.accepted_at && <span>Accepted: {new Date(m.accepted_at).toLocaleDateString()}</span>}
              {m.published_at && <span>Published: {new Date(m.published_at).toLocaleDateString()}</span>}
              {m.published_url && <a href={m.published_url} target="_blank" rel="noopener noreferrer">Open paper <ExternalLink size={10} /></a>}
              {m.doi && <span>DOI: {m.doi}</span>}
              <button onClick={() => setEditing(true)} className="btn btn-sm btn-ghost"><Edit3 size={11} /> Edit</button>
            </div>
          )}

          {/* Status transition */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Change status:</span>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
              {MANUSCRIPT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Note (optional)" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
            <button onClick={transition} className="btn btn-sm btn-primary" disabled={busy || newStatus === m.status}>Apply</button>
          </div>

          {/* Comments */}
          <ManuscriptCommentsBlock manuscriptId={m.id} reloadKey={m.comment_count} />
          <form onSubmit={submitComment} style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" style={{ ...inputStyle, flex: 1 }} />
            <button type="submit" className="btn btn-sm btn-primary">Post</button>
          </form>
        </div>
      )}
    </div>
  );
}

function ManuscriptCommentsBlock({ manuscriptId, reloadKey }) {
  const [comments, setComments] = useState([]);
  useEffect(() => {
    // We re-fetch via getManuscript because list endpoint doesn't include comments
    import('../../services/api').then(({ getManuscript }) =>
      getManuscript(manuscriptId).then(r => setComments(r.data?.comments || [])).catch(() => {})
    );
  }, [manuscriptId, reloadKey]);
  if (comments.length === 0) {
    return <div style={{ ...emptyStyle, padding: '6px 0' }}>No comments yet.</div>;
  }
  return (
    <div>
      {comments.map(c => (
        <div key={c.id} style={{ padding: '6px 0', fontSize: '0.83rem' }}>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.74rem' }}>
            <strong>{c.user_name || `User #${c.user_id}`}</strong> • {new Date(c.created_at).toLocaleString()}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
        </div>
      ))}
    </div>
  );
}

// ── Section card wrapper ─────────────────────────────────

function SectionCard({ title, onAdd, children }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h4>
        {onAdd && (
          <button onClick={onAdd} style={iconBtnStyle} title="Add"><Plus size={14} /></button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Shared inline styles ─────────────────────────────────

const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--color-border-light)' };
const inputStyle = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: '0.86rem', boxSizing: 'border-box', background: 'white' };
const iconBtnStyle = { background: 'transparent', border: '1px solid var(--color-border-light)', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const emptyStyle = { padding: '14px 0', textAlign: 'center', color: 'var(--color-text-light)', fontSize: '0.85rem' };
const errStyle = { background: 'var(--color-error-bg)', color: 'var(--color-error-text)', padding: 8, borderRadius: 6, fontSize: '0.82rem', marginBottom: 8 };

// One recording, with an inline player. Play asks for a signed link and the
// <video> streams it, so a long recording starts at once instead of being
// downloaded whole first (that timed out: "Could not load the recording.").
// The link is only requested on demand, so opening the Post-meeting tab
// doesn't touch every recording.
function RecordingRow({ meetingId, rec, onDeleted }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [tr, setTr] = useState({ text: '', busy: false, err: '' });
  const [busyDel, setBusyDel] = useState(false);
  const [showTr, setShowTr] = useState(false);

  // Transcription is kicked off automatically when a recording stops, so on
  // mount we just look for one that already exists rather than generating.
  useEffect(() => {
    let cancelled = false;
    getRecordingTranscript(meetingId, rec.id)
      .then((r) => { if (!cancelled) setTr((t) => ({ ...t, text: r.data.edited_text || r.data.raw_text || '' })); })
      .catch(() => { /* 404 = not transcribed yet, which is normal */ });
    return () => { cancelled = true; };
  }, [meetingId, rec.id]);

  const remove = async () => {
    // Spell out both consequences: the file is unlinked from disk, and the
    // transcript goes with it (FK cascade). Neither is recoverable.
    const when = new Date(rec.recorded_at || rec.created_at).toLocaleString();
    if (!window.confirm(
      `Delete the recording from ${when}?\n\n`
      + 'The video file will be permanently removed from the server, '
      + 'along with its transcript. This cannot be undone.')) return;
    setBusyDel(true);
    try {
      await deleteMeetingRecording(meetingId, rec.id);
      onDeleted?.(rec.id);
    } catch (e) {
      setTr((t) => ({ ...t, err: e.response?.data?.detail || 'Could not delete the recording.' }));
      setBusyDel(false);
    }
  };

  const downloadTranscript = async () => {
    try {
      const res = await downloadRecordingTranscript(meetingId, rec.id);
      const href = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = href;
      // Server sets the filename in Content-Disposition; mirror it for the anchor.
      a.download = `transcript-${rec.id}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setTr((t) => ({ ...t, err: 'Could not download the transcript.' }));
    }
  };

  const toggleTranscript = async () => {
    if (tr.text) { setShowTr((v) => !v); return; }
    setTr((t) => ({ ...t, busy: true, err: '' }));
    try {
      const r = await generateMeetingTranscript(meetingId, rec.id);
      setTr({ text: r.data.raw_text || '', busy: false, err: '' });
      setShowTr(true);
    } catch (e) {
      setTr((t) => ({ ...t, busy: false, err: e.response?.data?.detail || 'Could not transcribe this recording.' }));
    }
  };

  const load = async () => {
    if (url || loading) return;
    setLoading(true); setErr('');
    try {
      setUrl(await getMeetingRecordingPlayUrl(meetingId, rec.id));
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not load the recording.');
    } finally { setLoading(false); }
  };

  // A fresh link with download=true: the server sends it as an attachment and
  // the browser saves it itself, without holding the file in memory.
  const download = async () => {
    try {
      const a = document.createElement('a');
      a.href = await getMeetingRecordingPlayUrl(meetingId, rec.id, { download: true });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not download the recording.');
    }
  };

  const when = rec.recorded_at ? new Date(rec.recorded_at) : new Date(rec.created_at);

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--color-border-light)' }}>
      {/* Two lines rather than one. This card sits in a narrow grid column, and
          a single row made the timestamp wrap into the source label and pushed
          the buttons out of alignment between rows. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <Video size={15} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, alignSelf: 'center' }} />
        <span style={{ fontSize: '0.86rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {rec.duration_seconds != null && `${Math.max(1, Math.round(rec.duration_seconds / 60))} min · `}
          {rec.source === 'provider' ? 'recorded' : rec.source}
        </span>
      </div>

      {/* Buttons wrap as a group, so every row lines up regardless of which
          actions are available on it. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {!url ? (
          <button className="btn btn-sm btn-outline" onClick={load} disabled={loading}>
            <Play size={13} /> {loading ? 'Loading…' : 'Play'}
          </button>
        ) : (
          <button className="btn btn-sm btn-ghost" onClick={download} title="Download recording">
            <Download size={13} /> Video
          </button>
        )}

        {/* Each recording has its own transcript — a meeting started and stopped
            several times has several, and one shouldn't overwrite another. */}
        <button className="btn btn-sm btn-outline" onClick={toggleTranscript} disabled={tr.busy}
          title={tr.text ? 'Show transcript' : 'Transcribe this recording'}>
          <FileText size={13} />
          {tr.busy ? 'Transcribing…' : tr.text ? (showTr ? 'Hide' : 'Transcript') : 'Transcribe'}
        </button>

        {tr.text && (
          <button className="btn btn-sm btn-ghost" onClick={downloadTranscript} title="Download transcript (.txt)">
            <Download size={13} />
          </button>
        )}

        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={remove} disabled={busyDel}
          title="Delete this recording and its file from the server"
          style={{ color: 'var(--color-danger, var(--color-error))' }}>
          <Trash2 size={13} />
        </button>
      </div>

      {tr.err && <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--color-error-text)' }}>{tr.err}</div>}
      {showTr && tr.text && (
        <div style={{ marginTop: 10, padding: 12, background: 'var(--color-bg-secondary, var(--color-bg))',
          border: '1px solid var(--color-border-light)', borderRadius: 8,
          maxHeight: 260, overflowY: 'auto', fontSize: '0.84rem', lineHeight: 1.55,
          whiteSpace: 'pre-wrap' }}>
          {tr.text}
        </div>
      )}
      {err && <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--color-error-text)' }}>{err}</div>}
      {url && (
        <video src={url} controls style={{ width: '100%', marginTop: 10, borderRadius: 8, background: 'var(--color-text)' }}
          // The signed link expires after a few hours; drop it so Play fetches a new one.
          onError={() => { setUrl(null); setErr('Playback stopped. Press Play to load it again.'); }} />
      )}
    </div>
  );
}
