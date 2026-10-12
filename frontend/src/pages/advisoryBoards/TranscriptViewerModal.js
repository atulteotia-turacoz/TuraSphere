import React, { useEffect, useState } from 'react';
import { X, FileText, Loader, Download } from 'lucide-react';
import { getMeetingTranscript } from '../../services/api';

// Standalone, read-only transcript viewer — a quick "separate" way to read the
// post-meeting transcript without opening the board workspace. The transcript
// itself is produced post-meeting (Zoom auto-transcript synced from the cloud
// recording, or added by a writer) and still lives in the Post phase too.
export default function TranscriptViewerModal({ meetingId, title, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    getMeetingTranscript(meetingId)
      .then((r) => { if (!cancelled) setState({ loading: false, data: r.data }); })
      .catch((e) => {
        if (cancelled) return;
        const msg = e.response?.status === 404
          ? 'No transcript yet. It becomes available after the meeting — Zoom’s auto-transcript syncs with the cloud recording, or a writer can add one.'
          : e.response?.status === 403
            // Organizer-only. The menu item is hidden for everyone else, so this
            // is only reachable via a stale page or a hand-typed URL.
            ? 'Only the meeting organizer can view this transcript.'
            : (e.response?.data?.detail || 'Could not load the transcript.');
        setState({ loading: false, error: msg });
      });
    return () => { cancelled = true; };
  }, [meetingId]);

  const text = state.data ? (state.data.edited_text || state.data.raw_text || '') : '';

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'transcript').replace(/[^\w.-]+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1500, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{
        maxWidth: 720, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <FileText size={16} /> Transcript
            </h3>
            {title && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>{title}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {state.data && (
              <>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'capitalize', padding: '3px 9px', borderRadius: 999, background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}>
                  {state.data.status}
                </span>
                {text && (
                  <button className="btn btn-sm btn-ghost" onClick={download} title="Download .txt">
                    <Download size={14} />
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {state.loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-secondary)' }}>
              <Loader size={22} className="spinning" />
            </div>
          ) : state.error ? (
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>{state.error}</p>
          ) : text ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.6 }}>{text}</pre>
          ) : (
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-light)' }}>The transcript is empty.</p>
          )}
        </div>
      </div>
    </div>
  );
}
