import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LogOut, BarChart3, ClipboardList, MessageSquare, ExternalLink, RefreshCw, Loader, Maximize2, Minimize2, Captions, CalendarX2, RotateCcw } from 'lucide-react';
import MeetingVideo from './advisoryBoards/MeetingVideo';
import LiveKitRoom from './advisoryBoards/LiveKitRoom';
import MeetingChatPanel from './advisoryBoards/MeetingChatPanel';
import LiveTranscriptPanel from './advisoryBoards/LiveTranscriptPanel';
import {
  getMeeting, listMeetingSurveys, listMeetingPolls,
  getMeetingChat, sendMeetingChat, setMeetingChatEnabled,
  getLiveKitToken, getLiveKitRecording, startLiveKitRecording, stopLiveKitRecording, reopenMeeting,
  muteLiveKitParticipant, removeLiveKitParticipant,
} from '../services/api';

// Dedicated full-screen meeting room: 70% live video on the left, a 30%
// engagement panel (Polls / Surveys / Chat) on the right.
export default function MeetingRoomPage() {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [maximized, setMaximized] = useState(false);
  const [recording, setRecording] = useState(false);
  // Epoch seconds from LiveKit, so the elapsed timer is right after a reload.
  const [recordingStartedAt, setRecordingStartedAt] = useState(null);
  // Only the organizer may record. Rather than duplicating that rule here, we
  // ask the API: it 403s for anyone else, and we hide the button on that.
  const [canRecord, setCanRecord] = useState(false);

  useEffect(() => {
    getMeeting(meetingId).then((r) => setMeeting(r.data)).catch(() => {});
  }, [meetingId]);

  // Read the recording state from LiveKit rather than trusting local state, and
  // keep re-reading every 15s: it corrects the start time once egress reports
  // one, and catches a recording started or stopped from another tab.
  useEffect(() => {
    if (meeting?.video_provider !== 'livekit') return undefined;
    let cancelled = false;
    const read = () => getLiveKitRecording(meetingId)
      .then((r) => {
        if (cancelled) return;
        setCanRecord(true);
        setRecording(!!r.data.recording);
        setRecordingStartedAt(r.data.started_at || null);
      })
      .catch(() => { if (!cancelled) setCanRecord(false); });
    read();
    const id = setInterval(read, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [meetingId, meeting?.video_provider]);

  const fetchLkToken = useCallback(() => getLiveKitToken(meetingId), [meetingId]);

  // The meeting was ended or cancelled (the API 410s the join). Say so, and let
  // an organizer reopen it right here — the API decides who may.
  const [ended, setEnded] = useState(null);          // server's reason, or null
  const [roomKey, setRoomKey] = useState(0);         // bump to remount the room after reopening
  const [reopening, setReopening] = useState(false);
  const [reopenErr, setReopenErr] = useState('');
  const reopenAndJoin = async () => {
    setReopening(true); setReopenErr('');
    try {
      await reopenMeeting(meetingId);
      setEnded(null);
      setRoomKey((k) => k + 1);
      getMeeting(meetingId).then((r) => setMeeting(r.data)).catch(() => {});
    } catch (e) {
      setReopenErr(e.response?.status === 403
        ? 'Only the meeting organizer can reopen it. Ask them to reopen the meeting, then join again.'
        : (e.response?.data?.detail || 'Could not reopen the meeting.'));
    } finally {
      setReopening(false);
    }
  };

  // Gated on the same canRecord flag as recording: it comes from the API 403ing
  // for non-organizers, so one check covers every host action.
  const muteParticipant = useCallback(
    (identity, trackSid, muted) => muteLiveKitParticipant(meetingId, identity, trackSid, muted), [meetingId]);
  const removeParticipant = useCallback(
    (identity) => removeLiveKitParticipant(meetingId, identity), [meetingId]);

  const toggleRecording = useCallback(async (next) => {
    // Let the error surface to the room's control bar — "nobody has joined yet"
    // is a real answer the organizer needs to see.
    const r = next ? await startLiveKitRecording(meetingId) : await stopLiveKitRecording(meetingId);
    setRecording(!!r.data.recording);
    // Egress may not have reported a start time yet; the room falls back to
    // counting from now and the next status read corrects it.
    setRecordingStartedAt(r.data.started_at || null);
  }, [meetingId]);

  // The room is opened with window.open from the meeting page, so this tab has
  // no history to go back to — navigate(-1) did nothing, which is why Leave
  // appeared dead. Close the tab we opened; fall back to navigating for anyone
  // who reached this URL directly.
  const leave = useCallback(() => {
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    if (window.history.length > 1) navigate(-1);
    else navigate('/advisory-boards#boards');
  }, [navigate]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-text)', color: 'var(--color-text-inverse)' }}>
      {/* Top bar */}
      <header style={{ flexShrink: 0, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={leave} title="Leave meeting"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-error)', border: 'none', color: 'var(--color-text-inverse)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
            <LogOut size={15} /> Leave
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {meeting?.title || 'Meeting'}
            </div>
            {meeting?.board_title && (
              <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{meeting.board_title}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => setMaximized((m) => !m)}
            title={maximized ? 'Show panel' : 'Maximise meeting area'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--color-text-inverse)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: '0.82rem' }}>
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {maximized ? 'Show panel' : 'Maximise'}
          </button>
          {meeting?.join_url && (
            <a href={meeting.join_url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-border-strong)', fontSize: '0.82rem', textDecoration: 'none' }}>
              <ExternalLink size={14} /> Open in Zoom
            </a>
          )}
        </div>
      </header>

      {/* Split: 30% engagement on the LEFT | 70% video (panel collapses when maximised) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: '0 0 30%', maxWidth: '30%', minWidth: 280, background: 'var(--color-surface)', color: 'var(--color-text)', borderRight: '1px solid rgba(0,0,0,0.1)', flexDirection: 'column', minHeight: 0, display: maximized ? 'none' : 'flex' }}>
          <EngagementPanel meetingId={meetingId} isOrganizer={canRecord} />
        </div>
        <div style={{ flex: maximized ? '1 1 100%' : '0 0 70%', maxWidth: maximized ? '100%' : '70%', minWidth: 0 }}>
          {ended !== null ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: 24, textAlign: 'center', background: 'var(--color-surface-dark, #111827)', color: 'var(--color-text-inverse)' }}>
              <CalendarX2 size={36} style={{ color: 'var(--color-warning)' }} />
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>This meeting has ended</div>
              <div style={{ fontSize: '0.88rem', opacity: 0.85, maxWidth: 440 }}>
                {ended || 'It was ended or cancelled, so it can no longer be joined.'} To hold it again, reopen it first.
              </div>
              {reopenErr && <div style={{ fontSize: '0.84rem', color: 'var(--color-warning)', maxWidth: 440 }}>{reopenErr}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button className="btn btn-primary" onClick={reopenAndJoin} disabled={reopening}>
                  {reopening ? <Loader size={15} className="spinning" /> : <RotateCcw size={15} />} Reopen &amp; join
                </button>
                <button className="btn btn-outline" onClick={leave} style={{ color: 'var(--color-text-inverse)', borderColor: 'rgba(255,255,255,0.35)' }}>
                  Back
                </button>
              </div>
            </div>
          ) : meeting?.video_provider === 'livekit' ? (
            // Our own room: no remount on maximise needed, the grid is CSS.
            <LiveKitRoom
              key={roomKey}
              onUnjoinable={(detail) => setEnded(detail || '')}
              sessionKey={meetingId}
              fetchToken={fetchLkToken}
              onLeave={leave}
              recording={recording}
              recordingStartedAt={recordingStartedAt}
              onRecordToggle={canRecord ? toggleRecording : undefined}
              onMute={canRecord ? muteParticipant : undefined}
              onRemoveParticipant={canRecord ? removeParticipant : undefined}
            />
          ) : (
            /* key changes with `maximized` so the embed re-measures + refits the
               video to the new column width (Zoom has no live-resize API). */
            <MeetingVideo key={maximized ? 'max' : 'split'} meetingId={meetingId}
              fallbackUrl={meeting?.join_url} onLeave={leave} />
          )}
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'polls',   label: 'Polls',   icon: BarChart3 },
  { id: 'surveys', label: 'Surveys', icon: ClipboardList },
  { id: 'chat',    label: 'Chat',    icon: MessageSquare },
];
// Organizer-only. Appended rather than always present, so a KOL has no tab to
// click and no hint that a transcript exists. The API 403s regardless.
const ORGANIZER_TABS = [
  { id: 'transcript', label: 'Transcript', icon: Captions },
];

function EngagementPanel({ meetingId, isOrganizer }) {
  const [tab, setTab] = useState('polls');
  const tabs = isOrganizer ? [...TABS, ...ORGANIZER_TABS] : TABS;
  return (
    <>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border-light)', flexShrink: 0 }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
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
      <div style={{ flex: 1, minHeight: 0, overflow: (tab === 'chat' || tab === 'transcript') ? 'hidden' : 'auto', padding: 14 }}>
        {tab === 'polls'   && <LinkedList meetingId={meetingId} kind="polls" />}
        {tab === 'surveys' && <LinkedList meetingId={meetingId} kind="surveys" />}
        {tab === 'chat'    && <ChatTab meetingId={meetingId} />}
        {tab === 'transcript' && <LiveTranscriptPanel meetingId={meetingId} />}
      </div>
    </>
  );
}

// Shared list for meeting-linked polls / surveys with an "Open" action.
function LinkedList({ meetingId, kind }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = kind === 'polls' ? await listMeetingPolls(meetingId) : await listMeetingSurveys(meetingId);
      setItems(r.data || []);
    } catch {
      setErr(`Could not load ${kind}.`);
    }
  }, [meetingId, kind]);
  useEffect(() => { load(); }, [load]);

  const open = (it) => {
    const url = kind === 'polls' ? '/polling' : `/surveys/${it.id}/results`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{kind === 'polls' ? 'Live Polls' : 'Surveys'}</h4>
        <button onClick={load} title="Refresh" className="btn btn-sm btn-ghost" style={{ padding: 4 }}><RefreshCw size={13} /></button>
      </div>
      {err ? (
        <p style={{ fontSize: '0.84rem', color: 'var(--color-error, var(--color-error))' }}>{err}</p>
      ) : items === null ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-light)' }}><Loader size={18} className="spinning" /></div>
      ) : items.length === 0 ? (
        <p style={{ fontSize: '0.84rem', color: 'var(--color-text-light)' }}>
          No {kind} linked to this meeting yet. Link {kind} from the board workspace.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <div key={it.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: '0.86rem', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title || it.question || `#${it.id}`}</span>
              <button className="btn btn-sm btn-outline" onClick={() => open(it)} style={{ flexShrink: 0 }}>
                <ExternalLink size={13} /> Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Our own persisted chat (not Zoom's) — messages stay with the board record and
// remain readable after the session ends. Organizers get the on/off switch.
// The transports are memoised because MeetingChatPanel keys its polling effect on
// them; inline arrows would restart the poll on every render.
function ChatTab({ meetingId }) {
  const fetchChat = useCallback((afterId) => getMeetingChat(meetingId, afterId), [meetingId]);
  const sendChat = useCallback((body) => sendMeetingChat(meetingId, body), [meetingId]);
  const setEnabled = useCallback((enabled) => setMeetingChatEnabled(meetingId, enabled), [meetingId]);
  return <MeetingChatPanel fetchChat={fetchChat} sendChat={sendChat} setEnabled={setEnabled} />;
}
