import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import ThemeToggle from '../components/common/ThemeToggle';
import {
  AlertCircle, Loader, LayoutDashboard, FileText, MessageSquare, Download,
  CheckCircle, XCircle, RotateCcw, Calendar, Briefcase, BarChart3, Lock, LogOut,
  Building2, Video, ClipboardList, ExternalLink, Users, CheckCircle2, Clock,
  BookOpen, ArrowRight, MapPin, Eye, ListOrdered, MessagesSquare,
} from 'lucide-react';
import {
  getClientPortal, getClientAgenda, listClientDocuments, downloadClientDocument, previewClientDocument,
  submitDocumentApproval, getClientEngagement,
  clientPortalLogin, setClientSession, clearClientSession, getClientSurveyResponses,
  getClientDiscussion, addClientSessionComment, deleteClientSessionComment,
  addClientComment, deleteClientComment, getClientLiveKitToken, getClientChat, sendClientChat, getClientPolls,
  listClientRoomDocuments, previewClientRoomDocument,
} from '../services/api';
import LiveKitRoom from './advisoryBoards/LiveKitRoom';
import MeetingChatPanel from './advisoryBoards/MeetingChatPanel';
import { downloadSurveyCsv } from '../utils/surveyCsv';
import EngagementDashboard, { SurveyResults } from './advisoryBoards/EngagementDashboard';
import SessionDiscussion from './advisoryBoards/SessionDiscussion';
import DocumentPreviewModal, { groupBySection } from '../components/common/DocumentPreviewModal';

// Scoped to this page. Media queries, hover and keyframes can't be expressed
// as inline styles, and all three are needed here. Mirrors the participant
// portal's shell so a client and an expert see one product, not two.
const shellStyles = `
.cp-col { max-width: 1100px; margin: 0 auto; }
.cp-bar { background: var(--color-surface); border-bottom: 1px solid var(--color-border-light); }
.cp-barinner { display: flex; align-items: flex-start; gap: 20px; padding: 26px 20px 18px; flex-wrap: wrap; }
.cp-meta { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 12px;
           font-size: 0.83rem; color: var(--color-text-secondary); }
.cp-meta span { display: inline-flex; align-items: center; gap: 5px; }
.cp-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 11px; border-radius: 999px;
           font-size: 0.72rem; font-weight: 700; }
.cp-tabs { display: flex; gap: 2px; padding: 0 20px; overflow-x: auto; }
.cp-tab { display: inline-flex; align-items: center; gap: 7px; padding: 11px 16px; cursor: pointer;
          background: none; border: none; border-bottom: 2px solid transparent; white-space: nowrap;
          font-weight: 600; font-size: 0.86rem; color: var(--color-text-secondary); }
.cp-tab:hover { color: var(--color-text); }
.cp-tab-on { color: var(--color-primary); border-bottom-color: var(--color-primary); }
.cp-two { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
@media (max-width: 900px) { .cp-two { grid-template-columns: minmax(0, 1fr); } }
.cp-card { background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 12px; }
/* Named cp-METER, not cp-bar: cp-bar is the page banner above, and a second
   rule with that name collapsed the banner (and the tabs inside it) to 8px. */
.cp-meter { height: 8px; border-radius: 999px; background: var(--color-surface-raised); overflow: hidden; }
.cp-meter > span { display: block; height: 100%; border-radius: 999px; background: var(--color-primary); }
.cp-lbl { font-size: 0.68rem; text-transform: uppercase; letter-spacing: .05em;
          color: var(--color-text-light); font-weight: 700; }
`;

const BOARD_STATUS = {
  planning: { label: 'Planning', bg: 'var(--color-info-bg)', fg: 'var(--color-info-text)' },
  scheduled: { label: 'Scheduled', bg: 'var(--color-info-bg)', fg: 'var(--color-info-text)' },
  in_progress: { label: 'In Progress', bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-text)' },
  completed: { label: 'Completed', bg: 'var(--color-success-bg)', fg: 'var(--color-success-text)' },
  cancelled: { label: 'Cancelled', bg: 'var(--color-error-bg)', fg: 'var(--color-error-text)' },
};
const PHASE_LABEL = {
  pre_meeting: 'Pre-meeting', meeting: 'Meeting', post_meeting: 'Post-meeting',
  ongoing_support: 'Ongoing support', event_specific: 'Event-specific',
};
const APPROVAL = {
  pending: { label: 'Pending review', bg: 'var(--color-surface-raised)', fg: 'var(--color-text-secondary)' },
  approved: { label: 'Approved', bg: 'var(--color-success-bg)', fg: 'var(--color-success-text)' },
  changes_requested: { label: 'Changes requested', bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-text)' },
  rejected: { label: 'Rejected', bg: 'var(--color-error-bg)', fg: 'var(--color-error-text)' },
};

export default function PublicClientPortalPage() {
  const { token } = useParams();
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [tab, setTab] = useState('dashboard');
  // The meeting the client has opened in the in-app (LiveKit) room, if any.
  const [roomMeeting, setRoomMeeting] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getClientPortal(token);
      setPortal(res.data);
      setPageError('');
    } catch (err) {
      setPageError(err.response?.status === 404
        ? 'This client link is invalid or has expired.'
        : 'Failed to load the client portal.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // A session that expired mid-visit shows the lock screen again rather than a
  // page of failed panels. api.js broadcasts this on any client-portal 401.
  useEffect(() => {
    const onLocked = (e) => {
      if (e.detail && e.detail !== token) return;
      clearClientSession(token);
      setPortal(p => (p ? { ...p, locked: true } : p));
    };
    window.addEventListener('client-portal-locked', onLocked);
    return () => window.removeEventListener('client-portal-locked', onLocked);
  }, [token]);

  // Lets a client end their session on a shared machine.
  const signOut = () => {
    clearClientSession(token);
    setPortal(p => (p ? { ...p, locked: true } : p));
  };

  if (loading) return (
    <div style={wrap}>
      <div style={{ textAlign: 'center' }}>
        <Loader size={32} className="spinning" style={{ color: 'var(--color-primary)' }} />
        <p style={{ marginTop: 12, color: 'var(--color-text-secondary)' }}>Loading…</p>
      </div>
    </div>
  );

  if (pageError) return (
    <div style={wrap}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <AlertCircle size={48} style={{ color: 'var(--color-error)', marginBottom: 16 }} />
        <h2 style={{ margin: '0 0 8px' }}>Portal Unavailable</h2>
        <p style={{ color: 'var(--color-text-secondary)' }}>{pageError}</p>
      </div>
    </div>
  );

  // Password gate. The link is the first factor; this is the second.
  if (portal.locked) {
    return <ClientLockScreen token={token} portal={portal} onUnlocked={load} />;
  }

  if (roomMeeting) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-text)', color: 'var(--color-text-inverse)' }}>
      <header style={{ flexShrink: 0, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {roomMeeting.title || 'Meeting'}
        </span>
        <button onClick={() => setRoomMeeting(null)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-error)', border: 'none', color: 'var(--color-text-inverse)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
          <LogOut size={15} /> Leave
        </button>
      </header>
      {/* Chat panel on the LEFT, video on the right — same split as the
          expert's room on the join page. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: '0 0 30%', maxWidth: 380, minWidth: 280, background: 'var(--color-surface)', color: 'var(--color-text)', borderRight: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ClientRoomPanel token={token} meetingId={roomMeeting.id} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LiveKitRoom
            sessionKey={`client-${token}-${roomMeeting.id}`}
            fetchToken={() => getClientLiveKitToken(token, roomMeeting.id)}
            onLeave={() => setRoomMeeting(null)}
          />
        </div>
      </div>
    </div>
  );

  const { client, board } = portal;
  const st = BOARD_STATUS[board.status] || BOARD_STATUS.planning;
  // One board is one meeting in this product, so the client's engagement view
  // reports on the board's meeting without asking them to choose one.
  const engagementMeetingId = portal.meetings?.[0]?.id || null;

  const TABS = [
    // The landing view: everything at a glance, with a way through to the tab
    // that holds the detail. Status keeps the board's particulars.
    { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
    { key: 'status', label: 'Status', Icon: Briefcase },
    // The running order of the day. It existed only on the team side, so a
    // client could read every document but not see what the meeting covers.
    ...(engagementMeetingId ? [{ key: 'agenda', label: 'Agenda', Icon: ListOrdered }] : []),
    { key: 'documents', label: 'Documents', Icon: FileText },
    // The board's one conversation: the client, the expert panel and the
    // project team in a single thread. The old private client<->team "Messages"
    // tab was removed on 2026-09-21 — it was never used, and this is where the
    // client now answers what an expert has said.
    ...(engagementMeetingId ? [{ key: 'discussion', label: 'Discussion', Icon: MessagesSquare }] : []),
    // Only offered when there is a meeting to report on — an engagement tab
    // that can only ever say "no meeting" is worse than no tab.
    ...(engagementMeetingId ? [
      // The expert panel — the same people whether you reach them as KOLs
      // assigned to the board or as participants invited to the meeting.
      { key: 'experts', label: 'Experts', Icon: Users },
      { key: 'engagement', label: 'Engagement', Icon: BarChart3 },
      // Its own tab, not just a block at the bottom of Engagement. The survey
      // is what the client commissioned the board to find out — burying the
      // answers under the reading-time charts had them asking where they were.
      { key: 'surveys', label: 'Survey Results', Icon: ClipboardList },
    ] : []),
  ];

  const nextMeeting = portal.meetings?.find(m => m.status === 'scheduled' || m.status === 'live')
    || portal.meetings?.[0] || null;
  const when = nextMeeting?.scheduled_at ? new Date(nextMeeting.scheduled_at) : null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <style>{shellStyles}</style>
      <ThemeToggle className="theme-toggle-floating" />

      {/* Banner — the board this portal is for, plus who is signed in. */}
      <div className="cp-bar">
        <div className="cp-col cp-barinner">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7, flexWrap: 'wrap' }}>
              <span className="cp-pill" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                {PHASE_LABEL[board.current_phase] || board.current_phase}
              </span>
            </div>
            <h1 style={{ fontSize: '1.55rem', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{board.title}</h1>
            <div className="cp-meta">
              {board.sponsor && <span><Briefcase size={13} /> {board.sponsor}</span>}
              <span><Calendar size={13} /> {when ? when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date to be confirmed'}</span>
              <span style={{ textTransform: 'capitalize' }}>{(board.format || '').replace('_', ' ')}</span>
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.82rem' }}>
              Signed in as <strong>{client.name}</strong>
            </div>
            {client.organization && (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>{client.organization}</div>
            )}
            {/* Only meaningful on a password-protected portal — without one,
                "sign out" would just reopen the same page. */}
            {portal.password_protected && (
              <button className="btn btn-sm btn-ghost" onClick={signOut} title="End this session"
                      style={{ marginTop: 6 }}>
                <LogOut size={14} /> Sign out
              </button>
            )}
          </div>
        </div>

        <div className="cp-col cp-tabs">
          {TABS.map(t => {
            const active = tab === t.key;
            const Icon = t.Icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={active ? 'cp-tab cp-tab-on' : 'cp-tab'}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="cp-col" style={{ padding: '22px 20px 56px' }}>
        {tab === 'dashboard' && (
          <ClientDashboardTab token={token} board={board} meetings={portal.meetings}
                              meetingId={engagementMeetingId} onGo={setTab} onJoin={setRoomMeeting} />
        )}
        {tab === 'status' && <StatusTab board={board} meetings={portal.meetings} />}
        {/* Documents and Messages are single lists — held to a readable column
            rather than stretched across the full width the engagement
            dashboard needs. */}
        {tab === 'agenda' && engagementMeetingId && (
          <div style={{ maxWidth: 780 }}><AgendaTab token={token} meetingId={engagementMeetingId} /></div>
        )}
        {tab === 'documents' && <div style={{ maxWidth: 780 }}><DocumentsTab token={token} /></div>}
        {tab === 'discussion' && engagementMeetingId && (
          <div style={{ maxWidth: 800 }}>
            <ClientDiscussionTab token={token} meetingId={engagementMeetingId} />
          </div>
        )}
        {tab === 'experts' && engagementMeetingId && (
          <div style={{ maxWidth: 860 }}>
            <ClientExpertsTab token={token} meetingId={engagementMeetingId} />
          </div>
        )}
        {tab === 'engagement' && engagementMeetingId && (
          <ClientEngagementTab token={token} meetingId={engagementMeetingId} />
        )}
        {tab === 'surveys' && engagementMeetingId && (
          <div style={{ maxWidth: 860 }}>
            <ClientSurveysTab token={token} meetingId={engagementMeetingId} />
          </div>
        )}
      </div>
    </div>
  );
}

// The client's side panel in the meeting room — the organizer's Polls /
// Surveys / Chat tabs. The organizer's tabs link out to the platform's polling
// and survey pages, which need a login, so the client reads the results here.
const ROOM_TABS = [
  { key: 'polls', label: 'Polls', Icon: BarChart3 },
  { key: 'surveys', label: 'Surveys', Icon: ClipboardList },
  { key: 'chat', label: 'Chat', Icon: MessageSquare },
  // Only the material filed for use DURING the meeting — the rest is on the
  // dashboard's Documents tab already.
  { key: 'docs', label: 'Documents', Icon: FileText },
];

function ClientRoomPanel({ token, meetingId }) {
  const [tab, setTab] = useState('polls');
  // Memoised because MeetingChatPanel keys its polling effect on these.
  const fetchChat = useCallback((afterId) => getClientChat(token, meetingId, afterId), [token, meetingId]);
  const sendChat = useCallback((body) => sendClientChat(token, meetingId, body), [token, meetingId]);
  return (
    <>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border-light)', flexShrink: 0 }}>
        {ROOM_TABS.map(t => {
          const active = tab === t.key;
          const Icon = t.Icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 8px', border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: '0.82rem', fontWeight: 600,
                color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
              }}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: tab === 'chat' ? 'hidden' : 'auto', padding: 14 }}>
        {tab === 'polls' && <RoomPolls token={token} meetingId={meetingId} />}
        {tab === 'surveys' && <RoomSurveys token={token} meetingId={meetingId} />}
        {tab === 'chat' && <MeetingChatPanel fetchChat={fetchChat} sendChat={sendChat} />}
        {tab === 'docs' && <RoomDocuments token={token} meetingId={meetingId} />}
      </div>
    </>
  );
}

// Live tallies, re-read every 10s so votes cast during the meeting show up
// without the client having to refresh.
function RoomPolls({ token, meetingId }) {
  const [polls, setPolls] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => getClientPolls(token, meetingId)
    .then(r => { setPolls(r.data || []); setErr(''); })
    .catch(() => setErr('Could not load polls.')), [token, meetingId]);
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  if (err) return <p style={{ fontSize: '0.84rem', color: 'var(--color-error)' }}>{err}</p>;
  if (polls === null) return <div style={{ textAlign: 'center', padding: 20 }}><Loader size={18} className="spinning" /></div>;
  if (polls.length === 0) return <p style={{ fontSize: '0.84rem', color: 'var(--color-text-light)' }}>No polls linked to this meeting yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {polls.map(pl => (
        <div key={pl.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{pl.title}</span>
            <span style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              {pl.total_votes} vote{pl.total_votes === 1 ? '' : 's'} · {pl.status}
            </span>
          </div>
          {(pl.questions || []).map((q, qi) => {
            const counts = pl.tallies?.[String(qi)] || {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <div key={qi} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 5 }}>{q.title}</div>
                {(q.options || []).map((o, oi) => {
                  const n = counts[String(oi)] || 0;
                  const pct = total ? Math.round((100 * n) / total) : 0;
                  return (
                    <div key={oi} style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem' }}>
                        <span>{o.text}</span><span style={{ color: 'var(--color-text-secondary)' }}>{n} · {pct}%</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--color-surface-raised)' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'var(--color-primary)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Opens in its own browser tab rather than a modal: the client presents by
// sharing that tab with Share screen, and a modal would share the room itself.
function RoomDocuments({ token, meetingId }) {
  const [docs, setDocs] = useState(null);
  const [err, setErr] = useState('');
  const [openErr, setOpenErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    listClientRoomDocuments(token, meetingId)
      .then(r => { if (!cancelled) setDocs(r.data || []); })
      .catch(() => { if (!cancelled) setErr('Could not load documents.'); });
    return () => { cancelled = true; };
  }, [token, meetingId]);

  const open = async (doc) => {
    setOpenErr('');
    // Opened before the request so the browser treats it as the click's popup.
    const win = window.open('', '_blank');
    try {
      const res = await previewClientRoomDocument(token, meetingId, doc.id);
      const type = res.data.type || (doc.preview_kind === 'pdf' ? 'application/pdf' : doc.mime_type);
      const url = window.URL.createObjectURL(new Blob([res.data], { type }));
      if (win) { win.location.href = url; } else { window.open(url, '_blank'); }
    } catch (e) {
      if (win) win.close();
      let msg = 'Could not open this document.';
      try { msg = JSON.parse(await e.response?.data?.text())?.detail || msg; } catch { /* keep default */ }
      setOpenErr(msg);
    }
  };

  if (err) return <p style={{ fontSize: '0.84rem', color: 'var(--color-error)' }}>{err}</p>;
  if (docs === null) return <div style={{ textAlign: 'center', padding: 20 }}><Loader size={18} className="spinning" /></div>;
  if (docs.length === 0) return <p style={{ fontSize: '0.84rem', color: 'var(--color-text-light)' }}>No documents filed for use during this meeting.</p>;

  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
        Open a document, then use Share screen and pick its tab to present it.
      </p>
      {openErr && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', margin: '0 0 8px' }}>{openErr}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {docs.map(d => (
          <div key={d.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
              {(d.session_title || d.section_title) && (
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>{d.session_title || d.section_title}</div>
              )}
            </div>
            <button className="btn btn-sm btn-outline" onClick={() => open(d)} style={{ flexShrink: 0 }}>
              <ExternalLink size={13} /> Open
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomSurveys({ token, meetingId }) {
  const [surveys, setSurveys] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    getClientEngagement(token, meetingId)
      .then(r => { if (!cancelled) setSurveys(r.data.surveys || []); })
      .catch(() => { if (!cancelled) setErr('Could not load surveys.'); });
    return () => { cancelled = true; };
  }, [token, meetingId]);

  if (err) return <p style={{ fontSize: '0.84rem', color: 'var(--color-error)' }}>{err}</p>;
  if (surveys === null) return <div style={{ textAlign: 'center', padding: 20 }}><Loader size={18} className="spinning" /></div>;
  if (surveys.length === 0) return <p style={{ fontSize: '0.84rem', color: 'var(--color-text-light)' }}>No surveys linked to this meeting yet.</p>;
  return <SurveyResults surveys={surveys} />;
}

function StatusTab({ board, meetings }) {
  const done = { completed: true, cancelled: true };
  return (
    <div className="cp-two">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {board.objective && (
          <div className="cp-card" style={{ padding: 20, borderLeft: '3px solid var(--color-primary)' }}>
            <div className="cp-lbl" style={{ marginBottom: 6 }}>Objective</div>
            <div style={{ fontSize: '0.93rem', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{board.objective}</div>
          </div>
        )}

        <div className="cp-card" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Calendar size={15} /> Meetings
            <span style={{ fontWeight: 400, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
              ({meetings.length})
            </span>
          </h3>
          {meetings.length === 0 ? (
            <div style={{ fontSize: '0.86rem', color: 'var(--color-text-light)' }}>
              No meetings scheduled yet — this is where they will appear.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {meetings.map(m => {
                const d = m.scheduled_at ? new Date(m.scheduled_at) : null;
                const live = m.status === 'live';
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px',
                    borderRadius: 9, border: '1px solid var(--color-border-light)',
                    background: 'var(--color-bg)', opacity: done[m.status] ? 0.72 : 1,
                  }}>
                    {/* Date block rather than a timestamp string — a client
                        scanning three meetings reads the day, not the seconds. */}
                    <div style={{
                      width: 46, flexShrink: 0, textAlign: 'center', borderRadius: 8, padding: '5px 0',
                      background: 'var(--color-surface-raised)', border: '1px solid var(--color-border-light)',
                    }}>
                      <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--color-text-light)', fontWeight: 700 }}>
                        {d ? d.toLocaleDateString(undefined, { month: 'short' }) : '—'}
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.1 }}>
                        {d ? d.getDate() : '?'}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.title}
                      </div>
                      <div style={{ fontSize: '0.77rem', color: 'var(--color-text-secondary)' }}>
                        {d ? d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Date to be confirmed'}
                      </div>
                    </div>
                    <span className="cp-pill" style={{
                      background: live ? 'var(--color-success-bg)' : 'var(--color-surface-raised)',
                      color: live ? 'var(--color-success-text)' : 'var(--color-text-secondary)',
                      textTransform: 'capitalize',
                    }}>{m.status}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Board facts, out of the way of the thing the client came to read. */}
      <div className="cp-card" style={{ padding: 18 }}>
        <div className="cp-lbl" style={{ marginBottom: 10 }}>Board details</div>
        <Field label="Sponsor" value={board.sponsor} icon={Briefcase} />
        <Field label="Client" value={board.client} icon={Building2} />
        <Field label="Format" value={(board.format || '').replace('_', ' ')} icon={Video} />
        <Field label="Scheduled" value={board.scheduled_date ? new Date(board.scheduled_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null} icon={Calendar} />
        <Field label="Current phase" value={PHASE_LABEL[board.current_phase] || board.current_phase} icon={LayoutDashboard} last />
      </div>
    </div>
  );
}

function AgendaTab({ token, meetingId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getClientAgenda(token, meetingId)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setError('Failed to load the agenda.'); });
    return () => { cancelled = true; };
  }, [token, meetingId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  const { meeting, items } = data;
  const when = meeting.scheduled_at ? new Date(meeting.scheduled_at) : null;
  const total = items.reduce((sum, it) => sum + (it.duration_minutes || 0), 0);

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div style={{ borderBottom: '1px solid var(--color-surface-raised)', paddingBottom: 12, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem' }}>{meeting.title}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span><Calendar size={12} /> {when ? when.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date to be confirmed'}</span>
          {meeting.duration_minutes ? <span><Clock size={12} /> {meeting.duration_minutes} min</span> : null}
          {/* Only worth showing once the items actually carry timings. */}
          {total > 0 && <span>{items.length} item{items.length === 1 ? '' : 's'} · {total} min planned</span>}
        </div>
        {meeting.agenda_summary && (
          <p style={{ margin: '8px 0 0', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>{meeting.agenda_summary}</p>
        )}
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: '0.88rem', color: 'var(--color-text-light)', padding: '14px 0' }}>
          The agenda for this meeting hasn't been published yet.
        </div>
      ) : items.map((it, i) => (
        <div key={it.id} style={{ display: 'flex', gap: 12, padding: '13px 0', borderBottom: '1px solid var(--color-surface-raised)' }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0, marginTop: 1,
            background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700,
          }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{it.title}</div>
            {it.description && (
              <div style={{ fontSize: '0.83rem', color: 'var(--color-text-secondary)', marginTop: 3 }}>{it.description}</div>
            )}
          </div>
          {it.duration_minutes ? (
            <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap', marginTop: 2 }}>
              {it.duration_minutes} min
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ token }) {
  const [docs, setDocs] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [commentFor, setCommentFor] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const res = await listClientDocuments(token); setDocs(res.data); }
    catch { setError('Failed to load documents.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const download = async (doc) => {
    try {
      const res = await downloadClientDocument(token, doc.id);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: doc.mime_type || 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url; a.download = doc.title || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch { setError('Download failed.'); }
  };

  // The portal sends its session header, so the file can't be an <iframe src> —
  // the shared viewer fetches the blob through this.
  const fetchPreviewBlob = useCallback(
    () => previewClientDocument(token, previewDoc.id),
    [token, previewDoc],
  );

  const decide = async (doc, status, comment) => {
    setBusyId(doc.id); setError('');
    try {
      await submitDocumentApproval(token, doc.id, status, comment || null);
      setCommentFor(null); setCommentText('');
      await load();
    } catch { setError('Could not save your decision.'); }
    finally { setBusyId(null); }
  };

  if (!docs) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {docs.length === 0 ? (
        <div style={{ fontSize: '0.88rem', color: 'var(--color-text-light)', padding: '12px 0' }}>No documents have been shared with you yet.</div>
      ) : groupBySection(docs).map(group => (
        <div key={group.key}>
          <div style={{
            fontSize: '0.74rem', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
            color: 'var(--color-text-light)', padding: '14px 0 2px',
          }}>
            {group.title || 'Other documents'}
          </div>
          {group.docs.map(doc => {
        const ap = doc.approval || { status: 'pending' };
        const badge = APPROVAL[ap.status] || APPROVAL.pending;
        return (
          <div key={doc.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--color-surface-raised)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <FileText size={20} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{doc.title}</div>
                {doc.session_title && (
                  <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
                    {doc.session_title}
                  </div>
                )}
                {ap.comment && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>“{ap.comment}”</div>}
              </div>
              <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: badge.bg, color: badge.fg, whiteSpace: 'nowrap' }}>
                {badge.label}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', paddingLeft: 32 }}>
              {doc.preview_kind && (
                <button className="btn btn-sm" onClick={() => setPreviewDoc(doc)} style={btnGhost}>
                  <Eye size={14} /> Preview
                </button>
              )}
              <button className="btn btn-sm" onClick={() => download(doc)} style={btnGhost}>
                <Download size={14} /> Download
              </button>
              <button className="btn btn-sm" disabled={busyId === doc.id} onClick={() => decide(doc, 'approved')} style={{ ...btnGhost, color: 'var(--color-success-text)', borderColor: 'var(--color-success-bg)' }}>
                <CheckCircle size={14} /> Approve
              </button>
              <button className="btn btn-sm" onClick={() => { setCommentFor(commentFor === doc.id ? null : doc.id); setCommentText(''); }} style={{ ...btnGhost, color: 'var(--color-warning-text)', borderColor: 'var(--color-warning-bg)' }}>
                <RotateCcw size={14} /> Request changes
              </button>
              <button className="btn btn-sm" onClick={() => { setCommentFor(commentFor === doc.id ? null : doc.id); setCommentText(''); }} style={{ ...btnGhost, color: 'var(--color-error-text)', borderColor: 'var(--color-error-bg)' }}>
                <XCircle size={14} /> Reject
              </button>
            </div>

            {commentFor === doc.id && (
              <div style={{ marginTop: 10, paddingLeft: 32 }}>
                <textarea className="form-control" rows={2} placeholder="Add a note (optional)…"
                  value={commentText} onChange={e => setCommentText(e.target.value)} style={{ resize: 'vertical', marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" disabled={busyId === doc.id} onClick={() => decide(doc, 'changes_requested', commentText)} style={{ ...btnGhost, color: 'var(--color-warning-text)', borderColor: 'var(--color-warning-bg)' }}>
                    Submit "Request changes"
                  </button>
                  <button className="btn btn-sm" disabled={busyId === doc.id} onClick={() => decide(doc, 'rejected', commentText)} style={{ ...btnGhost, color: 'var(--color-error-text)', borderColor: 'var(--color-error-bg)' }}>
                    Submit "Reject"
                  </button>
                </div>
              </div>
            )}
          </div>
        );
          })}
        </div>
      ))}
      {previewDoc && (
        <DocumentPreviewModal
          doc={previewDoc} kind={previewDoc.preview_kind}
          fetchBlob={fetchPreviewBlob}
          onClose={() => setPreviewDoc(null)}
          onDownload={() => download(previewDoc)}
        />
      )}
    </div>
  );
}


function Field({ label, value, icon: Icon, last }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '9px 0',
      borderBottom: last ? 'none' : '1px solid var(--color-border-light)',
    }}>
      {Icon && <Icon size={14} style={{ color: 'var(--color-text-light)', flexShrink: 0, marginTop: 2 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 600 }}>{label}</div>
        <div style={{
          fontSize: '0.87rem', marginTop: 1, lineHeight: 1.4,
          textTransform: label === 'Format' ? 'capitalize' : 'none',
          color: value ? 'var(--color-text)' : 'var(--color-text-light)',
        }}>{value || '—'}</div>
      </div>
    </div>
  );
}

const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' };
const btnGhost = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 7, padding: '6px 11px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' };

// The panel's per-session discussion, which the client can answer. Its own
// component so the memoised callbacks are not rebuilt on every page render.
function ClientDiscussionTab({ token, meetingId }) {
  const fetcher = useCallback(() => getClientDiscussion(token, meetingId), [token, meetingId]);
  // The thread is flat, so the session is always null: a comment belongs to the
  // meeting, not to one session. The per-session routes stay for the forum
  // folded under each session on the expert dashboard, which feeds this thread.
  const post = useCallback(
    (sessionId, body) => (sessionId == null
      ? addClientComment(token, meetingId, body)
      : addClientSessionComment(token, meetingId, sessionId, body)),
    [token, meetingId]);
  const remove = useCallback(
    (sessionId, commentId) => (sessionId == null
      ? deleteClientComment(token, meetingId, commentId)
      : deleteClientSessionComment(token, meetingId, sessionId, commentId)),
    [token, meetingId]);
  return (
    <SessionDiscussion
      fetcher={fetcher} onPost={post} onDelete={remove}
      title="Discussion"
      subtitle="The board's discussion — what the expert panel has said, and your replies. The experts and the project team see everything posted here."
    />
  );
}

// Wrapper so the memoised fetcher lives in a component of its own rather than
// being created inside a conditional render in the page body.
function ClientEngagementTab({ token, meetingId }) {
  const fetcher = useCallback(() => getClientEngagement(token, meetingId), [token, meetingId]);
  // Surveys have their own tab in this portal — showing them here as well
  // would be the same content twice.
  return <EngagementDashboard fetcher={fetcher} showSurveys={false} />;
}

// The password gate. Shown when the client's link is protected and this tab has
// no valid session — either the first visit, or a session that has expired.
function ClientLockScreen({ token, portal, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    if (!password.trim()) { setError('Enter your password.'); return; }
    setBusy(true); setError('');
    try {
      const res = await clientPortalLogin(token, password);
      setClientSession(token, res.data.session);
      await onUnlocked();
    } catch (err) {
      setError(err.response?.status === 401
        ? 'That password is not correct.'
        : 'Could not sign you in. Please try again.');
      setPassword('');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ ...wrap, padding: 20 }}>
      <form onSubmit={submit} className="card"
            style={{ padding: 28, width: 'min(400px, 100%)', textAlign: 'center' }}>
        <div style={{
          width: 46, height: 46, borderRadius: 14, margin: '0 auto 14px',
          background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Lock size={21} />
        </div>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>Client portal</h2>
        {portal.board_title && (
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginBottom: 4 }}>
            {portal.board_title}
          </div>
        )}
        <p style={{ color: 'var(--color-text-light)', fontSize: '0.82rem', margin: '0 0 18px' }}>
          {portal.client_name ? `Welcome, ${portal.client_name}. ` : ''}
          Enter the password the project team sent you.
        </p>

        <input
          className="form-control"
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          style={{ textAlign: 'center' }}
        />
        {error && (
          <div style={{ color: 'var(--color-error)', fontSize: '0.82rem', marginTop: 8 }}>{error}</div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}
                style={{ width: '100%', marginTop: 14 }}>
          {busy ? <><Loader size={16} className="spinning" /> Opening…</> : 'Open portal'}
        </button>
        <p style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', marginTop: 12, marginBottom: 0 }}>
          The password is sent separately from this link. If you don't have it, ask the project team.
        </p>
      </form>
    </div>
  );
}

// Survey results on their own tab. Reads the same engagement payload as the
// Engagement tab, so the two can never show different response counts.
function ClientSurveysTab({ token, meetingId }) {
  const [surveys, setSurveys] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getClientEngagement(token, meetingId)
      .then(r => { if (!cancelled) setSurveys(r.data.surveys || []); })
      .catch(e => {
        if (cancelled) return;
        setError(e.response?.status === 403
          ? 'You do not have access to these results.'
          : 'Could not load the survey results.');
      });
    return () => { cancelled = true; };
  }, [token, meetingId]);

  if (error) return <div className="cp-card" style={{ padding: 18, color: 'var(--color-error)' }}>{error}</div>;
  if (surveys === null) {
    return (
      <div className="cp-card" style={{ padding: 32, display: 'flex', justifyContent: 'center', gap: 9, alignItems: 'center' }}>
        <Loader size={15} className="spinning" />
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.86rem' }}>Loading survey results…</span>
      </div>
    );
  }
  if (surveys.length === 0) {
    // Says WHY it is empty. "No results" alone reads as a broken page when the
    // real answer is that no survey has been attached to the meeting yet.
    return (
      <div className="cp-card" style={{ padding: 26, textAlign: 'center' }}>
        <ClipboardList size={26} style={{ color: 'var(--color-text-light)', marginBottom: 10 }} />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>No survey linked to this meeting yet</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', maxWidth: 420, margin: '0 auto' }}>
          Once the project team attaches a pre- or post-meeting survey, every response
          appears here question by question.
        </div>
      </div>
    );
  }
  return <SurveyResults surveys={surveys} renderActions={(sv) => (
    <SurveyActions token={token} meetingId={meetingId} survey={sv} />
  )} />;
}

// Download the responses, or open the survey itself to read the questions as
// the experts saw them. The roll-up above answers "what did they say"; these
// two answer "give me the raw data" and "what exactly did you ask".
function SurveyActions({ token, meetingId, survey }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const download = async () => {
    setBusy(true); setErr('');
    try {
      const res = await getClientSurveyResponses(token, meetingId, survey.id);
      const ok = downloadSurveyCsv(res.data, `${res.data.title || 'survey'}_responses.csv`);
      if (!ok) setErr('There are no responses to download yet.');
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not download the responses.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
      {err && <span style={{ color: 'var(--color-error)', fontSize: '0.74rem' }}>{err}</span>}
      {survey.token && (
        <a className="btn btn-sm" style={btnGhost} href={`/survey/${survey.token}`}
           target="_blank" rel="noreferrer" title="Open the survey to read the questions">
          <ExternalLink size={13} /> View survey
        </a>
      )}
      <button className="btn btn-sm" style={btnGhost} onClick={download}
              disabled={busy || survey.response_count === 0}
              title={survey.response_count === 0 ? 'No responses yet' : 'Download every response as CSV'}>
        {busy ? <Loader size={13} className="spinning" /> : <Download size={13} />} Download
      </button>
    </div>
  );
}

// The expert panel. Reads the same engagement payload as the other tabs, so the
// names and counts here can never disagree with the Engagement dashboard.
const NAME_TITLES = /^(dr|prof|professor|mr|mrs|ms|miss)\b\.?\s*/i;
const sortableName = (name) => {
  let out = (name || '').trim();
  // "Prof. (Dr.) A. K. Sharma" — more than one title, and one in brackets.
  out = out.replace(/^\((dr|prof|professor)\b\.?\)\s*/i, '');
  while (NAME_TITLES.test(out)) out = out.replace(NAME_TITLES, '').replace(/^\((dr|prof|professor)\b\.?\)\s*/i, '');
  return out || (name || '');
};

function ClientExpertsTab({ token, meetingId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getClientEngagement(token, meetingId)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => {
        if (cancelled) return;
        setError(e.response?.status === 403
          ? 'You do not have access to the expert panel.'
          : 'Could not load the expert panel.');
      });
    return () => { cancelled = true; };
  }, [token, meetingId]);

  if (error) return <div className="cp-card" style={{ padding: 18, color: 'var(--color-error)' }}>{error}</div>;
  if (!data) {
    return (
      <div className="cp-card" style={{ padding: 32, display: 'flex', justifyContent: 'center', gap: 9, alignItems: 'center' }}>
        <Loader size={15} className="spinning" />
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.86rem' }}>Loading the expert panel…</span>
      </div>
    );
  }

  // A-Z by name. The server returns them in panel order (assignment, then
  // invite), which reads as random to a client scanning for one person.
  // Titles are stripped for the SORT KEY only — with "Dr" on every row the
  // list would otherwise be alphabetical by title, i.e. not sorted at all.
  const panel = [...(data.panel || [])].sort((a, b) =>
    sortableName(a.name).localeCompare(sortableName(b.name), undefined, { sensitivity: 'base' }));
  const totalSections = data.total_sections || 0;

  if (panel.length === 0) {
    return (
      <div className="cp-card" style={{ padding: 26, textAlign: 'center' }}>
        <Users size={26} style={{ color: 'var(--color-text-light)', marginBottom: 10 }} />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>No experts on the panel yet</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', maxWidth: 420, margin: '0 auto' }}>
          Once the project team assigns KOLs to this board or invites them to the meeting,
          they appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="cp-card" style={{ padding: 18 }}>
      <h3 style={{ margin: '0 0 3px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Users size={15} /> Expert panel
        <span style={{ fontWeight: 400, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
          ({panel.length})
        </span>
      </h3>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', margin: '0 0 14px' }}>
        Experts assigned to this advisory board, and whether they have been invited to the meeting yet.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {panel.map(e => (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px',
            borderRadius: 9, border: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
          }}>
            <span style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: 'var(--color-surface-raised)', border: '1px solid var(--color-border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)',
            }}>
              {(e.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{e.name}</div>
              <div style={{ fontSize: '0.77rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[e.specialty, e.affiliation, e.country].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {/* An expert assigned to the board but not yet invited has had no
                  chance to read anything — say that, rather than showing them
                  as an expert who ignored the material. */}
              {!e.invited ? (
                <span className="cp-pill" style={{ background: 'var(--color-surface-raised)', color: 'var(--color-text-light)' }}>
                  <Clock size={11} /> Not invited yet
                </span>
              ) : e.opened_any ? (
                <span className="cp-pill" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>
                  <CheckCircle2 size={11} /> Engaged
                </span>
              ) : (
                <span className="cp-pill" style={{ background: 'var(--color-surface-raised)', color: 'var(--color-text-secondary)' }}>
                  Invited
                </span>
              )}
              {e.invited && (
                <div style={{ fontSize: '0.71rem', color: 'var(--color-text-light)', marginTop: 3 }}>
                  {totalSections > 0 && `${e.sections_opened}/${totalSections} sections`}
                  {e.comment_count > 0 && `${totalSections > 0 ? ' · ' : ''}${e.comment_count} comment${e.comment_count === 1 ? '' : 's'}`}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The landing view. Reads the same engagement payload as the other tabs, so
// every number here is the one the detail tab will show.
function ClientDashboardTab({ token, board, meetings, meetingId, onGo, onJoin }) {
  const [data, setData] = useState(null);
  const [docs, setDocs] = useState(null);
  const [thread, setThread] = useState(null);
  const [agenda, setAgenda] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (meetingId) {
      getClientEngagement(token, meetingId)
        .then(r => { if (!cancelled) setData(r.data); })
        .catch(() => { if (!cancelled) setData(false); });
      getClientAgenda(token, meetingId)
        .then(r => { if (!cancelled) setAgenda(r.data?.items || []); })
        .catch(() => { if (!cancelled) setAgenda([]); });
    } else {
      setData(false);
      setAgenda([]);
    }
    // Documents and the discussion are already the client's own tabs; the
    // dashboard only summarises them, so it reuses the same two endpoints.
    listClientDocuments(token).then(r => { if (!cancelled) setDocs(r.data || []); }).catch(() => !cancelled && setDocs([]));
    if (meetingId) {
      getClientDiscussion(token, meetingId)
        .then(r => { if (!cancelled) setThread(r.data?.thread || []); })
        .catch(() => !cancelled && setThread([]));
    } else {
      setThread([]);
    }
    return () => { cancelled = true; };
  }, [token, meetingId]);

  const sm = data?.summary;
  const details = data?.details;
  const panel = data?.panel || [];
  const sections = data?.sections || [];
  const surveys = data?.surveys || [];

  const nextMeeting = meetings?.find(m => m.status === 'scheduled' || m.status === 'live') || meetings?.[0];
  const when = nextMeeting?.scheduled_at ? new Date(nextMeeting.scheduled_at) : null;
  // Floored at 0 — a meeting that has already started is not "-1 days away".
  const daysAway = when ? Math.max(0, Math.ceil((when - new Date()) / 86400000)) : null;

  const pendingApproval = (docs || []).filter(d => (d.approval?.status || 'pending') === 'pending');
  const pendingSurveys = surveys.filter(s => s.response_count === 0).length;
  const lastMessage = thread?.length ? thread[thread.length - 1] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Where the project has got to */}
      <PhaseTracker current={board.current_phase} />

      {/* Anything waiting on the CLIENT sits above everything else — it is the
          only part of this page they must act on rather than read. */}
      {pendingApproval.length > 0 && (
        <div className="cp-card" onClick={() => onGo('documents')}
             style={{ padding: 16, cursor: 'pointer', borderLeft: '3px solid var(--color-warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={18} style={{ color: 'var(--color-warning-text)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                {pendingApproval.length} document{pendingApproval.length === 1 ? '' : 's'} awaiting your review
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pendingApproval.slice(0, 3).map(d => d.title).join(', ')}
                {pendingApproval.length > 3 && ` +${pendingApproval.length - 3} more`}
              </div>
            </div>
            <ArrowRight size={15} style={{ color: 'var(--color-text-light)' }} />
          </div>
        </div>
      )}

      <div className="cp-two">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          {/* Next meeting + its particulars */}
          <div className="cp-card" style={{ padding: 20, borderLeft: '3px solid var(--color-primary)' }}>
            <div className="cp-lbl" style={{ marginBottom: 6 }}>Next meeting</div>
            {nextMeeting ? (
              <>
                <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{nextMeeting.title}</div>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginTop: 3 }}>
                  {when ? when.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Date to be confirmed'}
                  {daysAway != null && daysAway > 0 && ` · in ${daysAway} day${daysAway === 1 ? '' : 's'}`}
                  {nextMeeting.status === 'live' && ' · live now'}
                </div>

                {/* In-app (LiveKit) meetings open in the portal; a Zoom meeting
                    without an in-app session falls back to its external link. */}
                {nextMeeting.joinable && (nextMeeting.video_provider === 'livekit' || nextMeeting.join_url) && (
                  <div style={{ marginTop: 12 }}>
                    {nextMeeting.video_provider === 'livekit' ? (
                      <button className="btn btn-primary btn-sm" onClick={() => onJoin(nextMeeting)}>
                        <Video size={14} /> Join meeting
                      </button>
                    ) : (
                      <a className="btn btn-primary btn-sm" href={nextMeeting.join_url} target="_blank" rel="noopener noreferrer">
                        <Video size={14} /> Join meeting <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                )}

                {details && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-border-light)' }}>
                    <Field label="Agenda" value={details.agenda_summary || details.meeting_title} icon={ClipboardList} last />
                    <Field label="Time" value={details.time ? `${details.time} · ${details.duration_minutes || 60} min` : 'To be confirmed'} icon={Clock} last />
                    <div>
                      <Field label="Venue"
                             value={details.venue || (details.format === 'virtual' ? 'Virtual meeting' : 'To be confirmed')}
                             icon={MapPin} last />
                      {details.venue_map_url && (
                        <a href={details.venue_map_url} target="_blank" rel="noreferrer"
                           style={{ fontSize: '0.74rem', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 24 }}>
                          Google Maps <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--color-text-light)', fontSize: '0.88rem' }}>No meeting scheduled yet.</div>
            )}
          </div>

          {/* At a glance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Tile label="Experts" value={panel.length} icon={Users}
                  hint={sm ? `${sm.referred_any_count} have opened material` : null}
                  onClick={meetingId ? () => onGo('experts') : null} />
            <Tile label="Agenda" value={agenda == null ? '—' : agenda.length} icon={ListOrdered}
                  hint={agenda?.length ? 'Running order of the day' : 'Not published yet'}
                  onClick={meetingId ? () => onGo('agenda') : null} />
            <Tile label="Documents" value={docs == null ? '—' : docs.length} icon={FileText}
                  hint={pendingApproval.length ? `${pendingApproval.length} to review` : null}
                  onClick={() => onGo('documents')} />
            <Tile label="Expert comments" value={sm ? sm.total_comments : '—'} icon={MessageSquare}
                  onClick={meetingId ? () => onGo('engagement') : null} />
            <Tile label="Surveys" value={surveys.length} icon={ClipboardList}
                  hint={surveys.length ? (pendingSurveys ? `${pendingSurveys} with no responses` : 'all have responses') : null}
                  onClick={meetingId ? () => onGo('surveys') : null} />
          </div>

          {/* The question a client actually asks */}
          {sm && sm.total_experts > 0 && (
            <div className="cp-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <BookOpen size={15} /> Are the experts reading the material?
                </h3>
                <button onClick={() => onGo('engagement')} style={{
                  marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.82rem',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  Full engagement <ArrowRight size={13} />
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: '1.9rem', fontWeight: 700 }}>{sm.referred_any_pct}%</span>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.86rem' }}>
                  {sm.referred_any_count} of {sm.total_experts} experts have opened at least one document
                </span>
              </div>
              <div className="cp-meter" style={{ marginTop: 8 }}>
                <span style={{ width: `${sm.referred_any_pct}%` }} />
              </div>

              {/* Which session is lagging — the actionable half of the number */}
              {sections.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="cp-lbl" style={{ marginBottom: 8 }}>By session</div>
                  {sections.map(sec => (
                    <div key={sec.id} style={{ marginBottom: 9 }}>
                      <div style={{ display: 'flex', gap: 8, fontSize: '0.8rem', marginBottom: 3 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sec.title}
                        </span>
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          {sec.opened_count}/{sm.total_experts}
                        </span>
                      </div>
                      <div className="cp-meter" style={{ height: 6 }}>
                        <span style={{ width: `${sec.opened_pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sm.none_count > 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-warning-text)', marginTop: 10 }}>
                  {sm.none_count} expert{sm.none_count === 1 ? ' has' : 's have'} not opened anything yet
                  {sm.none_names?.length ? `: ${sm.none_names.join(', ')}` : ''}.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {board.objective && (
            <div className="cp-card" style={{ padding: 16 }}>
              <div className="cp-lbl" style={{ marginBottom: 6 }}>Objective</div>
              <div style={{ fontSize: '0.86rem', lineHeight: 1.55, whiteSpace: 'pre-line' }}>{board.objective}</div>
            </div>
          )}

          <div className="cp-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <div className="cp-lbl" style={{ flex: 1 }}>Latest in the discussion</div>
              <button onClick={() => onGo('discussion')} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.76rem',
              }}>All</button>
            </div>
            {lastMessage ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{lastMessage.author_name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
                    {new Date(lastMessage.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ fontSize: '0.84rem', marginTop: 4, lineHeight: 1.5,
                              display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {lastMessage.body}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-light)' }}>
                Nothing in the discussion yet. Use the Discussion tab to reach the panel and the project team.
              </div>
            )}
          </div>

          {panel.length > 0 && (
            <div className="cp-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <div className="cp-lbl" style={{ flex: 1 }}>Expert panel ({panel.length})</div>
                <button onClick={() => onGo('experts')} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.76rem',
                }}>All</button>
              </div>
              {panel.slice(0, 6).map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0' }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: e.opened_any ? 'var(--color-success)' : 'var(--color-border-strong)',
                  }} />
                  <span style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.name}
                  </span>
                </div>
              ))}
              {panel.length > 6 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginTop: 5 }}>
                  +{panel.length - 6} more
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!meetingId && (
        <div className="cp-card" style={{ padding: 20, color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          Engagement, experts and survey results appear here once a meeting is created for
          <strong> {board.title}</strong>.
        </div>
      )}
    </div>
  );
}

// Where the project has got to. The board's phase is a single value, so this is
// a read-only tracker, not a control — the client does not move the project on.
function PhaseTracker({ current }) {
  const steps = [
    { id: 'pre_meeting', label: 'Pre-Meeting' },
    { id: 'meeting', label: 'Meeting' },
    { id: 'post_meeting', label: 'Post-Meeting' },
  ];
  const idx = steps.findIndex(st => st.id === current);
  return (
    <div className="cp-card" style={{ padding: '14px 18px' }}>
      <div className="cp-lbl" style={{ marginBottom: 10 }}>Project stage</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {steps.map((st, i) => {
          const done = idx > i;
          const active = idx === i;
          const colour = done || active ? 'var(--color-primary)' : 'var(--color-border-strong)';
          return (
            <React.Fragment key={st.id}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: `2px solid ${colour}`,
                  background: done || active ? 'var(--color-primary)' : 'transparent',
                  color: 'var(--color-primary-contrast)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.66rem', fontWeight: 700,
                }}>
                  {done ? <CheckCircle2 size={12} /> : i + 1}
                </span>
                <span style={{
                  fontSize: '0.76rem', fontWeight: active ? 700 : 500,
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)', whiteSpace: 'nowrap',
                }}>{st.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 2, margin: '0 8px', marginBottom: 20,
                              background: idx > i ? 'var(--color-primary)' : 'var(--color-border-light)' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ label, value, icon: Icon, hint, onClick }) {
  return (
    <div className="cp-card" onClick={onClick || undefined}
         style={{ padding: 14, cursor: onClick ? 'pointer' : 'default' }}>
      <div className="cp-lbl" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={11} /> {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.2, marginTop: 3 }}>{value}</div>
      {hint && <div style={{ fontSize: '0.73rem', color: 'var(--color-text-light)' }}>{hint}</div>}
    </div>
  );
}
