import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle, Loader, Video, Clock, Users, CheckCircle, Shield,
  Mic, MessageSquare, MonitorUp, BarChart3, FileText, Download, Settings, ExternalLink,
  LayoutDashboard, ClipboardList, RefreshCw, CheckCircle2, LogOut, Calendar, ListOrdered, Eye,
} from 'lucide-react';
import {
  getMeetingJoinInfo, enterMeetingViaToken, publicJoinSdkSignature,
  getJoinMaterials, downloadJoinMaterial, getJoinEngagements, getJoinAgenda,
  getJoinChat, sendJoinChat, setJoinChatEnabled, getJoinLiveKitToken,
  getJoinDiscussion, addJoinComment, deleteJoinComment,
} from '../services/api';
import MeetingVideo from './advisoryBoards/MeetingVideo';
import LiveKitRoom from './advisoryBoards/LiveKitRoom';
import MeetingChatPanel from './advisoryBoards/MeetingChatPanel';
import ExpertDashboard, { DocViewer } from './advisoryBoards/ExpertDashboard';
import SessionDiscussion from './advisoryBoards/SessionDiscussion';
import { groupBySection } from '../components/common/DocumentPreviewModal';
import ThemeToggle from '../components/common/ThemeToggle';

const ROLE_LABEL = {
  host: 'Host', moderator: 'Moderator', panel_member: 'Panel Member',
  participant: 'Participant', observer: 'Observer',
};
const ROLE_BADGE = {
  host: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-text)' },
  moderator: { bg: 'var(--color-violet-bg)', fg: 'var(--color-violet)' },
  panel_member: { bg: 'var(--color-info-bg)', fg: 'var(--color-info)' },
  participant: { bg: 'var(--color-surface-raised)', fg: 'var(--color-text-secondary)' },
  observer: { bg: 'var(--color-surface-raised)', fg: 'var(--color-text-light)' },
};
const PERMISSION_META = {
  speak:              { label: 'Speak / unmute', Icon: Mic },
  chat:               { label: 'Send chat', Icon: MessageSquare },
  present:            { label: 'Present / share screen', Icon: MonitorUp },
  vote:               { label: 'Answer polls', Icon: BarChart3 },
  view_documents:     { label: 'View documents', Icon: FileText },
  download_documents: { label: 'Download documents', Icon: Download },
  manage:             { label: 'Host controls', Icon: Settings },
};
const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live now', completed: 'Completed', cancelled: 'Cancelled' };

// Scoped to this page. Inline styles can't carry media queries, hover or
// keyframes, and all three matter here.
const shellStyles = `
.pj-col { max-width: 1100px; margin: 0 auto; }
.pj-bar { background: var(--color-surface); border-bottom: 1px solid var(--color-border-light); }
.pj-barinner { display: flex; align-items: flex-start; gap: 20px; padding: 26px 20px 20px; flex-wrap: wrap; }
.pj-meta { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 12px;
           font-size: 0.83rem; color: var(--color-text-secondary); }
.pj-meta span { display: inline-flex; align-items: center; gap: 5px; }
.pj-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 11px; border-radius: 999px;
           font-size: 0.72rem; font-weight: 700; background: var(--color-info-bg); color: var(--color-info-text); }
.pj-pill-live { background: var(--color-success-bg); color: var(--color-success-text); }
.pj-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pj-pulse 1.8s ease-in-out infinite; }
@keyframes pj-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.pj-tabs { display: flex; gap: 2px; padding: 0 20px; overflow-x: auto; }
.pj-tab { display: inline-flex; align-items: center; gap: 7px; padding: 11px 16px; cursor: pointer;
          background: none; border: none; border-bottom: 2px solid transparent; white-space: nowrap;
          font-weight: 600; font-size: 0.86rem; color: var(--color-text-secondary); }
.pj-tab:hover { color: var(--color-text); }
.pj-tab-on { color: var(--color-primary); border-bottom-color: var(--color-primary); }
.pj-two { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
@media (max-width: 900px) { .pj-two { grid-template-columns: minmax(0, 1fr); } }
`;

export default function PublicMeetingJoinPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [entering, setEntering] = useState(false);
  const [entered, setEntered] = useState(false);
  const [joinUrl, setJoinUrl] = useState(null);
  const [error, setError] = useState('');
  // `?tab=materials` / `?tab=engagements` — the document-review and survey-reminder
  // emails deep-link here, so the recipient lands on what the email is about
  // instead of the overview.
  const [tab, setTab] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    return ['dashboard', 'overview', 'agenda', 'discussion', 'materials', 'engagements'].includes(wanted) ? wanted : 'dashboard';
  });
  const [inRoom, setInRoom] = useState(false);   // in-app meeting room open
  const [code, setCode] = useState('');          // access code from the invite email

  useEffect(() => {
    async function load() {
      try {
        const res = await getMeetingJoinInfo(token);
        setInfo(res.data);
      } catch (err) {
        const st = err.response?.status;
        if (st === 404) setPageError('This join link is invalid or has expired.');
        else setPageError('Failed to load the meeting.');
      } finally { setLoading(false); }
    }
    load();
  }, [token]);

  // Join IN-APP (on our platform) — no Zoom redirect. Records attendance and
  // opens the embedded meeting room.
  const handleEnter = async () => {
    if (info?.participant?.requires_code && !code.trim()) {
      setError('Enter the access code from your invitation email.');
      return;
    }
    setError(''); setEntering(true);
    try {
      const res = await enterMeetingViaToken(token);
      setInfo(res.data);
      setEntered(true);
      setJoinUrl(res.data?.join_url || null);
      // Only open the embedded room when there is actually one to open.
      // For Zoom that means a provisioned session (has_in_app_session); a LiveKit
      // meeting has no zoom_meeting_id at all, so it is gated on the provider
      // instead. Without a room, the checked-in state below is the useful
      // destination — it offers the external link when there is one.
      const mtg = res.data?.meeting;
      setInRoom(mtg?.video_provider === 'livekit' || !!mtg?.has_in_app_session);
    } catch (err) {
      const st = err.response?.status;
      if (st === 410) setError(err.response?.data?.detail || 'This meeting can no longer be joined.');
      else setError(err.response?.data?.detail || 'Could not join the meeting.');
    } finally { setEntering(false); }
  };

  if (loading) return (
    <div style={wrap}>
      <div style={{ textAlign: 'center' }}>
        <Loader size={32} className="spinning" style={{ color: 'var(--color-primary)' }} />
        <p style={{ marginTop: 12, color: 'var(--color-text-secondary)' }}>Loading meeting…</p>
      </div>
    </div>
  );

  if (pageError) return (
    <div style={wrap}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <AlertCircle size={48} style={{ color: 'var(--color-error)', marginBottom: 16 }} />
        <h2 style={{ margin: '0 0 8px' }}>Meeting Unavailable</h2>
        <p style={{ color: 'var(--color-text-secondary)' }}>{pageError}</p>
      </div>
    </div>
  );

  // In-app meeting room (embedded Zoom) — replaces the old zoom.us redirect.
  if (inRoom) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-text)', color: 'var(--color-text-inverse)' }}>
        <header style={{ flexShrink: 0, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {info?.meeting?.title || 'Meeting'}
          </span>
          <button onClick={() => setInRoom(false)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-error)', border: 'none', color: 'var(--color-text-inverse)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
            <LogOut size={15} /> Leave
          </button>
        </header>
        {/* Engagement panel on the LEFT, video on the right — same split as the
            in-platform meeting room. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: '0 0 30%', maxWidth: 380, minWidth: 280, background: 'var(--color-surface)', color: 'var(--color-text)', borderRight: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <RoomPanel token={token} meetingStatus={info?.meeting?.status} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {info?.meeting?.video_provider === 'livekit' ? (
              // Participants never get recording controls — the token the server
              // signs has room_record false, and no toggle is passed in.
              <LiveKitRoom
                sessionKey={token}
                fetchToken={() => getJoinLiveKitToken(token, code)}
                onLeave={() => setInRoom(false)}
              />
            ) : (
              <MeetingVideo
                sessionKey={token}
                fetchSignature={() => publicJoinSdkSignature(token, code)}
                fallbackUrl={joinUrl}
                onLeave={() => setInRoom(false)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  const m = info.meeting;
  const part = info.participant;
  const badge = ROLE_BADGE[part.role] || ROLE_BADGE.participant;
  const when = m.scheduled_at ? new Date(m.scheduled_at) : null;
  const perms = part.permissions || [];

  const TABS = [
    // The invited expert's landing page (Dr Shruti's spec). 'Overview' keeps the
    // join controls, role and permission detail it always had.
    { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
    { key: 'overview', label: 'Overview', Icon: Video },
    // The running order of the day. The dashboard groups material BY session,
    // but an item with no documents never showed up there at all.
    { key: 'agenda', label: 'Agenda', Icon: ListOrdered },
    // The discussion, promoted out of the folded panel under each session's
    // reading material. It is the part of the board the panel is asked to take
    // part in between meetings, and down there it was being missed — and it now
    // carries the client's and the project team's replies, so a question asked
    // here gets its answer here.
    { key: 'discussion', label: 'Discussion', Icon: MessageSquare },
    { key: 'materials', label: 'Materials', Icon: FileText },
    { key: 'engagements', label: 'Surveys & Polls', Icon: ClipboardList },
  ];

  // Date and time as two facts, not one blob — the same split the dashboard and
  // the client's own comments ask for.
  const dateStr = when ? when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBD';
  const timeStr = when ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  const isLive = m.status === 'live';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <style>{shellStyles}</style>
      <ThemeToggle className="theme-toggle-floating" />

      {/* ── Meeting bar ───────────────────────────────────────────────────
          A banner rather than a card in a column: it identifies the meeting,
          and it carries the Join button so the primary action is reachable
          from EVERY tab, not buried at the bottom of Overview. */}
      <div className="pj-bar">
        <div className="pj-col pj-barinner">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7, flexWrap: 'wrap' }}>
              <span className={isLive ? 'pj-pill pj-pill-live' : 'pj-pill'}>
                {isLive && <span className="pj-dot" />}
                {STATUS_LABELS[m.status] || m.status}
              </span>
              {m.board_name && (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {m.board_name}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: '1.55rem', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{m.title}</h1>
            {m.agenda_summary && (
              <p style={{ color: 'var(--color-text-secondary)', margin: '5px 0 0', fontSize: '0.9rem' }}>{m.agenda_summary}</p>
            )}
            <div className="pj-meta">
              <span><Calendar size={13} /> {dateStr}</span>
              {timeStr && <span><Clock size={13} /> {timeStr} · {m.duration_minutes || 60} min</span>}
              <span><Video size={13} /> {m.format}</span>
            </div>
          </div>

          {/* Join, promoted out of the Overview tab */}
          {info.joinable && !entered && (
            <button className="btn btn-primary btn-lg" disabled={entering}
                    onClick={() => {
                      // The access-code field lives on Overview. Joining from
                      // another tab would otherwise fail with "enter the code"
                      // beside no field to enter it in.
                      if (part.requires_code && !code.trim()) { setTab('overview'); return; }
                      handleEnter();
                    }}
                    style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {entering ? <><Loader size={17} className="spinning" /> Joining…</> : <><Video size={17} /> Join meeting</>}
            </button>
          )}
          {entered && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--color-success)', fontWeight: 700, fontSize: '0.9rem', flexShrink: 0 }}>
              <CheckCircle size={17} /> Checked in
            </span>
          )}
        </div>

        {/* Tabs, attached to the bar rather than floating above the content */}
        <div className="pj-col pj-tabs">
          {TABS.map(t => {
            const active = tab === t.key;
            const Icon = t.Icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={active ? 'pj-tab pj-tab-on' : 'pj-tab'}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pj-col" style={{ padding: '22px 20px 56px' }}>

        {tab === 'overview' && (
          <div className="pj-two">
            <div>
            {/* Your identity + role */}
            <div className="card" style={{ padding: '22px 26px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: badge.bg, color: badge.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, flexShrink: 0 }}>
                  {(part.name || '?')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{part.name || 'Participant'}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{part.organization || part.email || ''}</div>
                </div>
                <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 700, background: badge.bg, color: badge.fg }}>
                  {ROLE_LABEL[part.role] || part.role}
                </span>
              </div>

              {/* Permissions */}
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--color-surface-raised)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Shield size={13} /> Your permissions in this meeting
                </div>
                {perms.length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>View-only access.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px 14px' }}>
                    {Object.keys(PERMISSION_META).map(key => {
                      const meta = PERMISSION_META[key];
                      const on = perms.includes(key);
                      const Icon = meta.Icon;
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.83rem', color: on ? 'var(--color-text)' : 'var(--color-border-strong)' }}>
                          <Icon size={15} style={{ color: on ? 'var(--color-primary)' : 'var(--color-border-strong)', flexShrink: 0 }} />
                          <span style={{ textDecoration: on ? 'none' : 'line-through' }}>{meta.label}</span>
                          {on && <CheckCircle size={13} style={{ color: 'var(--color-success)', marginLeft: 'auto' }} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            </div>

            {/* Join / check-in rail */}
            <div style={{ position: 'sticky', top: 16 }}>
            {error && (
              <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="card" style={{ padding: '22px 20px', textAlign: 'center' }}>
              {!info.joinable ? (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                  <Users size={28} style={{ color: 'var(--color-border-strong)', marginBottom: 8 }} />
                  <div>This meeting is <strong>{STATUS_LABELS[m.status] || m.status}</strong> and is not open to join.</div>
                </div>
              ) : entered ? (
                <div>
                  <CheckCircle size={32} style={{ color: 'var(--color-success)', marginBottom: 8 }} />
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>You’re checked in.</div>
                  {joinUrl ? (
                    <>
                      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 14 }}>
                        {m.has_in_app_session
                          ? 'If the meeting didn’t open automatically, use the button below.'
                          : 'This meeting runs on Zoom rather than in the portal — use the button below to open it.'}
                      </p>
                      <a className="btn btn-primary btn-lg" href={joinUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={18} /> Open meeting
                      </a>
                    </>
                  ) : (
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                      The host hasn’t added a meeting link yet. Your attendance has been recorded — please check back shortly.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {!m.has_join_url && (
                    <p style={{ fontSize: '0.82rem', color: 'var(--color-warning-text)', marginBottom: 12 }}>
                      The meeting link hasn’t been set up yet — you can still check in.
                    </p>
                  )}
                  {part.requires_code && (
                    <div style={{ marginBottom: 12, textAlign: 'left' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                        Access code <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>(from your email)</span>
                      </label>
                      <input
                        className="form-control"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        placeholder="e.g. K7P2QX"
                        maxLength={12}
                        style={{ letterSpacing: 2, textAlign: 'center', fontWeight: 600 }}
                      />
                    </div>
                  )}
                  <button className="btn btn-primary btn-lg btn-block" onClick={handleEnter} disabled={entering} style={{ width: '100%' }}>
                    {entering ? <><Loader size={18} className="spinning" /> Joining…</> : <><Video size={18} /> Join meeting</>}
                  </button>
                  <p style={{ fontSize: '0.76rem', color: 'var(--color-text-light)', marginTop: 10 }}>
                    Joining records your attendance with your assigned role.
                  </p>
                </>
              )}
            </div>
            </div>
          </div>
        )}

        {tab === 'dashboard' && <ExpertDashboard token={token} />}
        {/* Both are single lists — held to a readable column instead of being
            stretched across the full 1100px the dashboard needs. */}
        {tab === 'agenda' && (
          <div style={{ maxWidth: 720 }}><JoinAgendaTab token={token} /></div>
        )}
        {tab === 'discussion' && (
          <div style={{ maxWidth: 760 }}><JoinDiscussionTab token={token} /></div>
        )}
        {tab === 'materials' && (
          <div style={{ maxWidth: 720 }}><MaterialsTab token={token} /></div>
        )}
        {tab === 'engagements' && (
          <div style={{ maxWidth: 720 }}><EngagementsTab token={token} meetingStatus={m.status} /></div>
        )}
      </div>
    </div>
  );
}

// Side panel inside the meeting room: the surveys/polls the participant can act
// on, plus the persisted chat. Mirrors the in-platform room's panel so both
// audiences see the same thing in the same place.
function RoomPanel({ token, meetingStatus }) {
  const [tab, setTab] = useState('engage');

  // Memoised because MeetingChatPanel keys its polling effect on these; inline
  // arrows would restart the poll on every render.
  const fetchChat = useCallback((afterId) => getJoinChat(token, afterId), [token]);
  const sendChat = useCallback((body) => sendJoinChat(token, body), [token]);
  const setEnabled = useCallback((enabled) => setJoinChatEnabled(token, enabled), [token]);

  const PANEL_TABS = [
    { key: 'engage', label: 'Surveys & Polls', Icon: ClipboardList },
    { key: 'chat', label: 'Chat', Icon: MessageSquare },
  ];

  return (
    <>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-surface-raised)', flexShrink: 0 }}>
        {PANEL_TABS.map(t => {
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
        {tab === 'engage' && <EngagementsTab token={token} meetingStatus={meetingStatus} />}
        {tab === 'chat' && (
          <MeetingChatPanel fetchChat={fetchChat} sendChat={sendChat} setEnabled={setEnabled} />
        )}
      </div>
    </>
  );
}

// The expert's Discussion tab. Its own wrapper so the memoised callbacks live
// in a component rather than being rebuilt on every render of the page.
function JoinDiscussionTab({ token }) {
  const fetcher = useCallback(() => getJoinDiscussion(token), [token]);
  // One thread: the session id is always null, so what is written here belongs
  // to the meeting. Commenting on a specific session is still possible from the
  // forum under it on the Dashboard tab, and lands in this same thread.
  const post = useCallback((_sessionId, body) => addJoinComment(token, body), [token]);
  const remove = useCallback((_sessionId, commentId) => deleteJoinComment(token, commentId), [token]);
  return (
    <SessionDiscussion
      fetcher={fetcher} onPost={post} onDelete={remove}
      title="Discussion"
      subtitle="Please feel free to add your thoughts — we will take these up during the meeting. The project team and the client can see and answer them here."
    />
  );
}


function JoinAgendaTab({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getJoinAgenda(token)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setError('Failed to load the agenda.'); });
    return () => { cancelled = true; };
  }, [token]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  const { meeting, items } = data;
  const when = meeting.scheduled_at ? new Date(meeting.scheduled_at) : null;
  const planned = items.reduce((sum, it) => sum + (it.duration_minutes || 0), 0);

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div style={{ borderBottom: '1px solid var(--color-surface-raised)', paddingBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem' }}>{meeting.title}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{when ? when.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date to be confirmed'}</span>
          {meeting.duration_minutes ? <span>{meeting.duration_minutes} min</span> : null}
          {planned > 0 && <span>{items.length} item{items.length === 1 ? '' : 's'} · {planned} min planned</span>}
        </div>
        {meeting.agenda_summary && (
          <p style={{ margin: '8px 0 0', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>{meeting.agenda_summary}</p>
        )}
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: '0.88rem', color: 'var(--color-text-light)', padding: '14px 0' }}>
          The agenda hasn't been published yet.
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

function MaterialsTab({ token }) {
  const [data, setData] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const res = await getJoinMaterials(token); setData(res.data); }
    catch { setError('Failed to load materials.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const download = async (doc) => {
    try {
      const res = await downloadJoinMaterial(token, doc.id);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: doc.mime_type || 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url; a.download = doc.title || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch { setError('Download failed.'); }
  };

  if (!data) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!data.can_view ? (
        <div style={{ fontSize: '0.88rem', color: 'var(--color-text-light)' }}>You don’t have permission to view documents for this meeting.</div>
      ) : data.documents.length === 0 ? (
        <div style={{ fontSize: '0.88rem', color: 'var(--color-text-light)' }}>No materials have been shared yet.</div>
      ) : groupBySection(data.documents).map(group => (
        <div key={group.key}>
          <div style={{
            fontSize: '0.74rem', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
            color: 'var(--color-text-light)', padding: '14px 0 2px',
          }}>
            {group.title || 'Other materials'}
          </div>
          {group.docs.map(doc => (
        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--color-surface-raised)' }}>
          <FileText size={20} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{doc.title}</div>
            {doc.session_title && (
              <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>
                {doc.session_title}
              </div>
            )}
          </div>
          {doc.preview_kind && (
            <button className="btn btn-sm" onClick={() => setViewing(doc)} style={btnGhost}>
              <Eye size={14} /> Preview
            </button>
          )}
          {data.can_download && (
            <button className="btn btn-sm" onClick={() => download(doc)} style={btnGhost}>
              <Download size={14} /> Download
            </button>
          )}
        </div>
          ))}
        </div>
      ))}
      {/* The dashboard's viewer, so reading here counts the same way. */}
      {viewing && <DocViewer token={token} doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function EngagementsTab({ token, meetingStatus }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const res = await getJoinEngagements(token); setData(res.data); }
    catch { setError('Failed to load surveys & polls.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="card" style={{ padding: 24, textAlign: 'center' }}><Loader size={22} className="spinning" /></div>;

  const open = (path) => window.open(`${window.location.origin}${path}`, '_blank', 'noopener,noreferrer');

  const Section = ({ title, items, kind }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--color-border-strong)' }}>None.</div>
      ) : items.map((it, i) => {
        const closed = it.status !== 'active';
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--color-surface-raised)' }}>
            {kind === 'poll' ? <BarChart3 size={18} style={{ color: 'var(--color-primary)' }} /> : <ClipboardList size={18} style={{ color: 'var(--color-primary)' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{it.title || 'Untitled'}</div>
              {it.responded && <div style={{ fontSize: '0.74rem', color: 'var(--color-success-text)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={12} /> Completed</div>}
              {!it.responded && closed && <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>Not open yet</div>}
            </div>
            <button className="btn btn-sm" disabled={closed && !it.responded} onClick={() => open(`/${kind === 'poll' ? 'poll' : 'survey'}/${it.token}`)}
              style={{ ...btnGhost, opacity: (closed && !it.responded) ? 0.5 : 1 }}>
              {it.responded ? 'View' : (kind === 'poll' ? 'Respond' : 'Complete')} <ExternalLink size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button className="btn btn-sm" onClick={load} style={btnGhost}><RefreshCw size={13} /> Refresh</button>
      </div>
      <Section title="Pre-meeting surveys" items={data.pre_surveys} kind="survey" />
      <Section title={`Live polls${meetingStatus === 'live' ? ' (meeting is live)' : ''}`} items={data.live_polls} kind="poll" />
      <Section title="Post-meeting surveys" items={data.post_surveys} kind="survey" />
      {!data.can_vote && data.live_polls.length > 0 && (
        <p style={{ fontSize: '0.76rem', color: 'var(--color-text-light)', margin: 0 }}>Note: you don’t have polling permission for this meeting.</p>
      )}
    </div>
  );
}

const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' };
const btnGhost = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 7, padding: '6px 11px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' };
