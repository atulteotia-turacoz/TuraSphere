import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Captions, CaptionsOff, Download } from 'lucide-react';
import { getLiveTranscript, startLiveTranscript, stopLiveTranscript } from '../../services/api';

// Running transcript with speaker names, shown while the meeting is live.
//
// ORGANIZER ONLY. The API 403s for anyone else, and the meeting room only mounts
// this panel when the caller is the organizer — but the guarantee is the 403, not
// the mount. A KOL cannot read the transcript, and cannot tell it is running.
//
// Segments arrive from a worker that joins the room and transcribes each
// participant's own audio track, which is where the speaker attribution comes
// from — the post-meeting transcript can't do that, because the recording mixes
// everyone into one stream.
const POLL_MS = 3000;

export default function LiveTranscriptPanel({ meetingId }) {
  const [segments, setSegments] = useState([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const lastIdRef = useRef(0);
  const scrollRef = useRef(null);
  // Only auto-scroll when already at the bottom, so polling can't yank the view
  // away from someone reading back through what was said.
  const pinnedRef = useRef(true);

  const apply = useCallback((data, replace) => {
    setRunning(!!data.running);
    const incoming = data.segments || [];
    if (replace) setSegments(incoming);
    else if (incoming.length) setSegments((prev) => [...prev, ...incoming]);
    if (incoming.length) lastIdRef.current = incoming[incoming.length - 1].id;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const tick = async (first) => {
      try {
        const r = await getLiveTranscript(meetingId, first ? undefined : lastIdRef.current || undefined);
        if (cancelled) return;
        apply(r.data, first);
        setErr('');
      } catch (e) {
        if (!cancelled && first) setErr(e.response?.status === 403
          ? 'Only the meeting organizer can view the live transcript.'
          : 'Could not load the transcript.');
      } finally {
        if (!cancelled) {
          if (first) setLoading(false);
          timer = setTimeout(() => tick(false), POLL_MS);
        }
      }
    };
    tick(true);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [meetingId, apply]);

  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const toggle = async () => {
    setBusy(true); setErr('');
    try {
      const r = running ? await stopLiveTranscript(meetingId) : await startLiveTranscript(meetingId);
      setRunning(!!r.data.running);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not change transcription.');
    } finally { setBusy(false); }
  };

  const download = () => {
    const body = segments
      .map((s) => `[${fmt(s.offset_seconds)}] ${s.speaker_name || 'Speaker'}: ${s.text}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `live-transcript-${meetingId}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center' }}><Loader size={20} className="spinning" /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <button onClick={toggle} disabled={busy}
          title={running ? 'Stop transcribing this meeting' : 'Start transcribing this meeting'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px',
            borderRadius: 7, cursor: busy ? 'default' : 'pointer', fontSize: '0.79rem', fontWeight: 600,
            border: `1px solid ${running ? 'var(--color-success)' : 'var(--color-border)'}`,
            background: running ? 'var(--color-success)' : 'var(--color-surface)',
            color: running ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
          }}>
          {busy ? <Loader size={13} className="spinning" /> : running ? <Captions size={13} /> : <CaptionsOff size={13} />}
          {running ? 'Transcribing' : 'Start transcript'}
        </button>
        {segments.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={download} title="Download what's captured so far">
            <Download size={13} />
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
          Only you can see this
        </span>
      </div>

      {err && <div style={{ fontSize: '0.76rem', color: 'var(--color-error-text)', marginBottom: 6 }}>{err}</div>}

      <div ref={scrollRef} onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {segments.length === 0 ? (
          <div style={{ fontSize: '0.83rem', color: 'var(--color-text-light)', textAlign: 'center', marginTop: 24 }}>
            {running
              ? 'Listening… lines appear as people speak.'
              : 'Start the transcript to capture what is said, with speaker names.'}
          </div>
        ) : segments.map((s) => (
          <div key={s.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: '0.79rem' }}>{s.speaker_name || 'Speaker'}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-light)' }}>{fmt(s.offset_seconds)}</span>
            </div>
            <div style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
