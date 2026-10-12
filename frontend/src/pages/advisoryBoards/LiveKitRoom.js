import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff,
  PhoneOff, Loader, AlertCircle, Circle, Square, Users, X, UserX,
} from 'lucide-react';

// Bots that join the room to do a job, not participants. Kept in one place so
// the grid, the People panel and the counts all agree.
const HIDDEN_IDENTITY = /^(EG_|livetx-)/;

// Self-hosted LiveKit room. Unlike the Zoom embed, every control here is ours —
// which is the whole reason for it: Zoom gates Record behind the customer's plan
// and renders its own UI in a fixed box we cannot lay out.
//
// `fetchToken()` resolves to { token, url, room, identity, is_organizer,
// can_record } — permissions are already signed into that token server-side, so
// this component never decides what someone is allowed to do; it only reflects it.
// `onRecordToggle(next)` is supplied by the caller (organizer only) so recording
// stays an API call the backend authorises, not a client decision.
export default function LiveKitRoom({ fetchToken, sessionKey, onLeave, onRecordToggle, recording,
                                     recordingStartedAt, onMute, onRemoveParticipant, onUnjoinable }) {
  const roomRef = useRef(null);
  const [phase, setPhase] = useState('connecting');   // connecting | live | error
  const [err, setErr] = useState('');
  const [participants, setParticipants] = useState([]);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  // Separate because the meeting permissions are separate: `speak` grants mic +
  // camera, `present` grants screen share. Showing a Share button to someone
  // whose token forbids it would just fail on click.
  const [canPublishVideo, setCanPublishVideo] = useState(false);
  const [canPublishScreen, setCanPublishScreen] = useState(false);
  const [busy, setBusy] = useState('');
  const [showPeople, setShowPeople] = useState(false);
  // Seconds since the recording began. Driven off the server's start time, so a
  // reload or a second tab shows the true elapsed time rather than restarting.
  const [elapsed, setElapsed] = useState(0);
  const onLeaveRef = useRef(onLeave);
  // True only once we're actually in the room — see the Disconnected handler.
  const joinedRef = useRef(false);
  useEffect(() => { onLeaveRef.current = onLeave; }, [onLeave]);

  // One entry per rendered tile. Rebuilt from the room on every participant or
  // track event rather than mutated, so a late subscribe can't leave a stale tile.
  const refresh = useCallback((room) => {
    const all = [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
      // Service participants are in the room but are not people: `EG_*` is the
      // egress recorder, `livetx-*` the live transcriber. Both would otherwise
      // occupy a tile, inflate the People count, and — for the transcriber —
      // reveal to a KOL that the meeting is being transcribed.
      .filter((p) => !HIDDEN_IDENTITY.test(p.identity || ''));
    setParticipants(all.map((p) => ({
      sid: p.sid,
      identity: p.identity,
      name: p.name || p.identity,
      isLocal: p === room.localParticipant,
      micEnabled: p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
      videoPub:
        p.getTrackPublication?.(Track.Source.ScreenShare) ||
        p.getTrackPublication?.(Track.Source.Camera) || null,
      // Remote audio is attached per tile; without this every remote joins muted.
      audioPub: p.getTrackPublication?.(Track.Source.Microphone) || null,
    })));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onChange = () => { if (!cancelled) refresh(room); };
    room
      .on(RoomEvent.ParticipantConnected, onChange)
      .on(RoomEvent.ParticipantDisconnected, onChange)
      .on(RoomEvent.TrackSubscribed, onChange)
      .on(RoomEvent.TrackUnsubscribed, onChange)
      .on(RoomEvent.TrackMuted, onChange)
      .on(RoomEvent.TrackUnmuted, onChange)
      .on(RoomEvent.LocalTrackPublished, onChange)
      .on(RoomEvent.LocalTrackUnpublished, onChange)
      .on(RoomEvent.ActiveSpeakersChanged, onChange)
      // Only treat a disconnect as "the meeting ended" once we were actually in
      // it. Firing onLeave during connection failure bounced the user straight
      // back to the portal, hiding the error card entirely — the symptom was
      // "Connecting…" and then the page reverting, with nothing explaining why.
      .on(RoomEvent.Disconnected, (reason) => {
        if (cancelled) return;
        if (joinedRef.current) { onLeaveRef.current?.(); return; }
        setErr(`Could not connect to the meeting server${reason ? ` (${reason})` : ''}. `
             + 'Check that the media ports are reachable, then try again.');
        setPhase('error');
      });

    (async () => {
      try {
        const { data } = await fetchToken();
        if (cancelled) return;
        await room.connect(data.url, data.token);
        if (cancelled) return;

        // What we may publish was decided by the server and is in the token; read
        // it back rather than assuming, so the buttons match reality.
        const perms = room.localParticipant.permissions;
        const allowed = !!perms?.canPublish;
        // LiveKit semantics: an EMPTY canPublishSources means "all sources", a
        // populated one is an allow-list. Accept both shapes — the JWT carries
        // names ("camera"), the JoinResponse protobuf carries the TrackSource
        // enum (1 camera, 2 microphone, 3 screen_share) — because which one
        // surfaces here depends on the SDK version.
        const sources = perms?.canPublishSources || [];
        const may = (num, name) => allowed && (
          sources.length === 0
          || sources.includes(num)
          || sources.some((s) => String(s).toLowerCase().includes(name))
        );
        setCanPublish(allowed);
        setCanPublishVideo(may(1, 'camera'));
        setCanPublishScreen(may(3, 'screen'));

        // Mic on, camera OFF. Turning a camera on is the participant's choice —
        // forcing it is intrusive, and someone with their camera off still
        // belongs on screen. The grid renders them as an initials tile instead
        // (see Tile), so a camera-off participant is visible and identifiable
        // rather than absent.
        if (allowed) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
            setMicOn(true);
          } catch { /* no mic, or permission denied */ }
        }
        joinedRef.current = true;
        refresh(room);
        setPhase('live');
      } catch (e) {
        if (cancelled) return;
        // The server says why (e.g. 410 "This meeting is completed and cannot be
        // joined") — show that, never axios's "Request failed with status code 410".
        const status = e?.response?.status;
        const detail = e?.response?.data?.detail;
        if (status === 410 && onUnjoinable) { onUnjoinable(detail); return; }
        setErr((typeof detail === 'string' && detail)
          || (status === 410 ? 'This meeting has ended and can no longer be joined.' : '')
          || e?.message || 'Could not join the meeting.');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      joinedRef.current = false;
      try { room.disconnect(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  useEffect(() => {
    if (!recording) { setElapsed(0); return undefined; }
    // No server time yet (the egress is still starting) — count from now, and the
    // next status poll corrects it.
    const startedMs = recordingStartedAt ? recordingStartedAt * 1000 : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [recording, recordingStartedAt]);

  const guard = async (key, fn) => {
    if (busy) return;
    setBusy(key); setErr('');
    try { await fn(); }
    catch (e) { setErr(e?.message || 'That control failed.'); }
    finally { setBusy(''); }
  };

  const toggleMic = () => guard('mic', async () => {
    const next = !micOn;
    const lp = roomRef.current.localParticipant;
    // The track is already published (muted) from join, so toggle its mute state
    // rather than re-publishing — republishing would churn the track and briefly
    // drop the person out of the recording composite.
    const pub = lp.getTrackPublication(Track.Source.Microphone);
    if (pub) {
      await (next ? pub.unmute() : pub.mute());
    } else {
      await lp.setMicrophoneEnabled(next);
    }
    setMicOn(next);
  });

  const toggleCam = () => guard('cam', async () => {
    const next = !camOn;
    await roomRef.current.localParticipant.setCameraEnabled(next);
    setCamOn(next);
  });

  const toggleShare = () => guard('share', async () => {
    const next = !sharing;
    await roomRef.current.localParticipant.setScreenShareEnabled(next);
    setSharing(next);
  });

  const leave = () => guard('leave', async () => {
    await roomRef.current.disconnect();
    onLeaveRef.current?.();
  });

  // Names of whoever is currently talking. Muted people are excluded: LiveKit
  // can still report speaking activity briefly around a mute, and labelling a
  // muted person as speaking is worse than saying nothing.
  const speakingNames = useMemo(() => {
    const names = participants.filter((p) => p.speaking && p.micEnabled).map((p) => p.name);
    if (!names.length) return '';
    return names.length <= 2 ? names.join(' and ') : `${names[0]} +${names.length - 1}`;
  }, [participants]);

  // Someone sharing a screen takes the stage; otherwise everyone shares a grid.
  const screenSharer = participants.find(
    (p) => p.videoPub?.source === Track.Source.ScreenShare && p.videoPub?.track);
  const columns = useMemo(() => {
    const n = Math.max(participants.length, 1);
    return Math.min(4, Math.ceil(Math.sqrt(n)));
  }, [participants.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--color-text)' }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: 8 }}>
        {/* Recording indicator — organizer only. `onRecordToggle` is supplied
            only when the API confirmed this user may record, so gating on it
            means nobody else can even tell a recording is running. */}
        {recording && onRecordToggle && phase === 'live' && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999,
            background: 'rgba(127,29,29,0.92)', color: 'var(--color-error-bg)', fontSize: '0.78rem', fontWeight: 600,
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-error)',
              animation: 'lk-rec-blink 1.4s ease-in-out infinite' }} />
            REC <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsed)}</span>
          </div>
        )}
        {phase === 'connecting' && (
          <Centered><Loader size={28} className="spinning" /><span>Connecting…</span></Centered>
        )}
        {phase === 'error' && (
          <Centered>
            <AlertCircle size={28} style={{ color: 'var(--color-warning)' }} />
            <span style={{ maxWidth: 420, textAlign: 'center' }}>{err}</span>
          </Centered>
        )}

        {/* Who is talking right now. The tile ring shows it too, but with a
            screen share on stage or several tiles at once the name is what
            actually tells you — and it survives the speaker's camera being off. */}
        {phase === 'live' && speakingNames && (
          <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
            display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '80%',
            padding: '6px 14px', borderRadius: 999, background: 'rgba(16,185,129,0.94)',
            color: 'var(--color-success-text)', fontSize: '0.8rem', fontWeight: 700,
            boxShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
            <Mic size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {speakingNames} speaking
            </span>
          </div>
        )}

        {/* Roster. The host actions come from the caller (organizer only) and go
            through the API, which re-checks the rule — the client never acts on
            a token it shouldn't have. */}
        {showPeople && phase === 'live' && (
          <div style={{ position: 'absolute', top: 8, right: 8, bottom: 8, width: 250, zIndex: 5,
            background: 'rgba(17,24,39,0.97)', color: 'var(--color-text-inverse)', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>People ({participants.length})</span>
              <button onClick={() => setShowPeople(false)} style={{ background: 'none', border: 'none', color: 'var(--color-border-strong)', cursor: 'pointer', display: 'inline-flex' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {participants.map((p) => (
                <div key={p.sid} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 6px' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}{p.isLocal ? ' (you)' : ''}
                  </span>
                  {p.micEnabled ? <Mic size={13} style={{ color: 'var(--color-text-light)' }} /> : <MicOff size={13} style={{ color: 'var(--color-error)' }} />}
                  {/* Toggle, not one-way: `enable_remote_unmute` is on in
                      infra/livekit.yaml, so the host can hand the mic back. */}
                  {onMute && !p.isLocal && p.audioPub?.trackSid && (
                    <button title={p.micEnabled ? 'Mute this person' : 'Unmute this person'}
                      onClick={() => guard(`mute-${p.sid}`, () => onMute(p.identity, p.audioPub.trackSid, p.micEnabled))}
                      disabled={!!busy}
                      style={{ ...miniBtn, color: p.micEnabled ? 'var(--color-border)' : 'var(--color-success)' }}>
                      {p.micEnabled ? <MicOff size={12} /> : <Mic size={12} />}
                    </button>
                  )}
                  {onRemoveParticipant && !p.isLocal && (
                    <button title="Remove from meeting"
                      onClick={() => { if (window.confirm(`Remove ${p.name} from this meeting?`)) guard(`kick-${p.sid}`, () => onRemoveParticipant(p.identity)); }}
                      disabled={!!busy} style={{ ...miniBtn, color: 'var(--color-error)' }}>
                      <UserX size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'live' && (
          screenSharer ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Tile p={screenSharer} contain />
              </div>
              <div style={{ display: 'flex', gap: 8, height: 110, flexShrink: 0, overflowX: 'auto' }}>
                {participants.filter((p) => p !== screenSharer).map((p) => (
                  <div key={p.sid} style={{ width: 160, flexShrink: 0 }}><Tile p={p} /></div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid', gap: 8, height: '100%',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: '1fr',
            }}>
              {participants.map((p) => <Tile key={p.sid} p={p} />)}
            </div>
          )
        )}
      </div>

      {err && phase === 'live' && (
        <div style={{ flexShrink: 0, background: 'var(--color-error-text)', color: 'var(--color-error-bg)', fontSize: '0.78rem', padding: '6px 12px' }}>
          {err}
        </div>
      )}

      <div style={{ flexShrink: 0, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 16, background: 'var(--color-text)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {canPublish ? (
          <>
            <Ctl onClick={toggleMic} live={micOn} busy={busy === 'mic'}
              icon={micOn ? <Mic size={18} /> : <MicOff size={18} />} label={micOn ? 'Mute' : 'Unmute'} />
            {canPublishVideo && (
              <Ctl onClick={toggleCam} live={camOn} busy={busy === 'cam'}
                icon={camOn ? <VideoIcon size={18} /> : <VideoOff size={18} />} label={camOn ? 'Stop video' : 'Start video'} />
            )}
            {canPublishScreen && (
              <Ctl onClick={toggleShare} tone={sharing ? 'active' : undefined} busy={busy === 'share'}
                icon={sharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />} label={sharing ? 'Stop share' : 'Share'} />
            )}
          </>
        ) : (
          // Silently omitting the controls read as a broken room. Say why: the
          // token's grants come from this participant's meeting permissions, so
          // the fix is on the meeting, not in here.
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--color-text-light)', fontSize: '0.8rem' }}>
            <MicOff size={15} />
            Listen-only — you don't have permission to speak in this meeting.
          </span>
        )}
        <Ctl onClick={() => setShowPeople((s) => !s)} tone={showPeople ? 'active' : undefined}
          icon={<Users size={18} />} label={`People (${participants.length})`} />
        {/* Organizer only — the caller passes this in, and the API refuses anyone else. */}
        {onRecordToggle && (
          <Ctl onClick={() => guard('rec', () => onRecordToggle(!recording))} busy={busy === 'rec'}
            tone={recording ? 'danger' : undefined}
            icon={recording ? <Square size={16} /> : <Circle size={16} />}
            label={recording ? `Stop • ${formatElapsed(elapsed)}` : 'Record'} />
        )}
        <Ctl onClick={leave} tone="danger" busy={busy === 'leave'} icon={<PhoneOff size={18} />} label="Leave" />
      </div>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--color-border)', fontSize: '0.9rem' }}>
      {children}
    </div>
  );
}

// Attaches the LiveKit track to a real <video>/<audio> element. Attach/detach is
// keyed on the track itself so a re-render doesn't tear down a live stream.
function Tile({ p, contain }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const track = p.videoPub?.track;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return undefined;
    track.attach(el);
    return () => { try { track.detach(el); } catch { /* ignore */ } };
  }, [track]);

  // Remote audio needs its own element; the local participant must never play
  // their own mic back or the room echoes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || p.isLocal) return undefined;
    const pub = p.audioPub;
    if (!pub?.track) return undefined;
    pub.track.attach(el);
    return () => { try { pub.track.detach(el); } catch { /* ignore */ } };
  }, [p.audioPub, p.isLocal]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0,
      background: 'var(--color-text)', borderRadius: 10, overflow: 'hidden',
      // A clear ring while someone is talking — this is how you tell who is
      // speaking when several tiles are on screen.
      boxShadow: p.speaking ? '0 0 0 3px var(--color-success)' : 'none',
      transition: 'box-shadow 120ms ease' }}>
      {track ? (
        <video ref={videoRef} autoPlay playsInline muted={p.isLocal}
          style={{ width: '100%', height: '100%', objectFit: contain ? 'contain' : 'cover' }} />
      ) : (
        // Camera off — show an initials avatar rather than an empty box, so
        // everyone in the room stays visible and identifiable.
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'var(--color-text)' }}>
          <div style={{
            width: 'clamp(48px, 28%, 104px)', aspectRatio: '1',
            borderRadius: '50%', background: avatarColor(p.name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-inverse)', fontWeight: 700, fontSize: 'clamp(0.95rem, 2.2vw, 2rem)',
            letterSpacing: 1, userSelect: 'none',
          }}>
            {initials(p.name)}
          </div>
        </div>
      )}
      {!p.isLocal && <audio ref={audioRef} autoPlay />}
      <div style={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(17,24,39,0.72)', color: 'var(--color-text-inverse)', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem' }}>
        {p.micEnabled ? <Mic size={11} /> : <MicOff size={11} style={{ color: 'var(--color-error)' }} />}
        {p.name}{p.isLocal ? ' (you)' : ''}
      </div>
    </div>
  );
}

function Ctl({ onClick, live, busy, icon, label, tone }) {
  const isToggle = live !== undefined;
  let bg, color;
  if (isToggle) {
    bg = live ? 'rgba(255,255,255,0.14)' : 'rgba(248,113,113,0.18)';
    color = live ? 'var(--color-surface)' : 'var(--color-error)';
  } else if (tone === 'danger') { bg = 'var(--color-error)'; color = 'var(--color-surface)'; }
  else if (tone === 'active') { bg = 'rgba(96,165,250,0.30)'; color = 'var(--color-surface)'; }
  else { bg = 'rgba(255,255,255,0.12)'; color = 'var(--color-surface)'; }
  return (
    <button onClick={onClick} disabled={busy || !onClick} title={label}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        cursor: onClick && !busy ? 'pointer' : 'default', background: 'transparent', border: 'none' }}>
      <span style={{ width: 42, height: 42, borderRadius: '50%', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: bg, color }}>
        {busy ? <Loader size={16} className="spinning" /> : icon}
      </span>
      <span style={{ fontSize: '0.66rem', color: 'var(--color-border-strong)' }}>{label}</span>
    </button>
  );
}

const miniBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
  background: 'rgba(255,255,255,0.10)', border: 'none', color: 'var(--color-border)',
};

// h:mm:ss once past an hour, m:ss before that — a board meeting can run long.
function formatElapsed(total) {
  const s = Math.max(0, total | 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

// Teams-style initials: first letter of the first and last name parts.
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

// Stable colour per person — derived from the name, so the same participant
// keeps the same avatar colour across tiles, reloads and meetings.
const AVATAR_COLORS = ['var(--color-primary)', 'var(--color-info)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-error)', 'var(--color-violet)', 'var(--color-pink)', 'var(--color-accent)'];
function avatarColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
