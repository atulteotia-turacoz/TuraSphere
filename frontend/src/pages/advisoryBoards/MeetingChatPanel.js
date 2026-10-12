import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader, MessageSquareOff, MessageSquare } from 'lucide-react';

// In-meeting chat, shared by the authenticated meeting room and the participant
// join room. Transport is injected so the same UI serves both:
//   fetchChat(afterId) -> { chat_enabled, can_send, can_manage, messages: [...] }
//   sendChat(body)     -> the created message
//   setEnabled(bool)   -> { chat_enabled }   (optional; omit to hide the switch)
//
// Delivery is polling rather than websockets: the backend already exposes an
// `after_id` delta and a meeting room is a short-lived, low-volume context, so a
// 4s poll keeps it simple with no socket infrastructure to run or scale.
const POLL_MS = 4000;

export default function MeetingChatPanel({ fetchChat, sendChat, setEnabled }) {
  const [messages, setMessages] = useState([]);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [canSend, setCanSend] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const lastIdRef = useRef(0);
  const scrollRef = useRef(null);
  // Only auto-scroll when the reader is already at the bottom, so polling can't
  // yank the view away from someone reading back through the transcript.
  const pinnedRef = useRef(true);

  const applyPayload = useCallback((data, { replace = false } = {}) => {
    setChatEnabled(data.chat_enabled);
    setCanSend(data.can_send);
    setCanManage(data.can_manage);
    const incoming = data.messages || [];
    if (replace) {
      setMessages(incoming);
    } else if (incoming.length) {
      setMessages((prev) => [...prev, ...incoming]);
    }
    if (incoming.length) lastIdRef.current = incoming[incoming.length - 1].id;
  }, []);

  // Initial load, then poll for deltas.
  useEffect(() => {
    let cancelled = false;
    let timer;

    const tick = async (first) => {
      try {
        const r = await fetchChat(first ? undefined : lastIdRef.current || undefined);
        if (cancelled) return;
        applyPayload(r.data, { replace: first });
        setErr('');
      } catch (e) {
        if (!cancelled && first) setErr('Could not load chat.');
      } finally {
        if (!cancelled) {
          if (first) setLoading(false);
          timer = setTimeout(() => tick(false), POLL_MS);
        }
      }
    };
    tick(true);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [fetchChat, applyPayload]);

  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const submit = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setErr('');
    try {
      const r = await sendChat(body);
      setDraft('');
      pinnedRef.current = true;
      // Append our own message immediately; the poll would otherwise skip it,
      // since it only ever asks for ids newer than the last one seen.
      setMessages((prev) => (prev.some((m) => m.id === r.data.id) ? prev : [...prev, r.data]));
      lastIdRef.current = Math.max(lastIdRef.current, r.data.id);
    } catch (e2) {
      setErr(e2.response?.data?.detail || 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  const toggle = async () => {
    if (!setEnabled) return;
    const next = !chatEnabled;
    try {
      const r = await setEnabled(next);
      setChatEnabled(r.data.chat_enabled);
      setErr('');
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not change the chat setting.');
    }
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center' }}><Loader size={20} className="spinning" /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Organizer's chat on/off switch */}
      {canManage && setEnabled && (
        <button onClick={toggle} title={chatEnabled ? 'Turn chat off for everyone' : 'Turn chat back on'}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', marginBottom: 8,
            border: '1px solid var(--color-border-light)', borderRadius: 7, cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 600, background: chatEnabled ? 'var(--color-surface)' : 'var(--color-error-bg)',
            color: chatEnabled ? 'var(--color-text-secondary)' : 'var(--color-error-text)', flexShrink: 0,
          }}>
          {chatEnabled ? <MessageSquare size={14} /> : <MessageSquareOff size={14} />}
          {chatEnabled ? 'Chat is on — turn off' : 'Chat is off — turn on'}
        </button>
      )}

      <div ref={scrollRef} onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
        {messages.length === 0 ? (
          <div style={{ fontSize: '0.84rem', color: 'var(--color-text-light)', margin: 'auto', textAlign: 'center' }}>
            No messages yet.
          </div>
        ) : messages.map((m) => (
          <div key={m.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
              <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{m.sender_name}</span>
              {m.sender_role && (
                <span style={{ fontSize: '0.68rem', color: 'var(--color-text-light)' }}>
                  {String(m.sender_role).replace(/_/g, ' ')}
                </span>
              )}
              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-light)', marginLeft: 'auto' }}>
                {m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {m.body}
            </div>
          </div>
        ))}
      </div>

      {err && <div style={{ fontSize: '0.76rem', color: 'var(--color-error-text)', marginTop: 6 }}>{err}</div>}

      <form onSubmit={submit} style={{ display: 'flex', gap: 6, marginTop: 10, flexShrink: 0 }}>
        <input
          className="form-control"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canSend}
          placeholder={
            !chatEnabled ? 'Chat is turned off'
              : !canSend ? 'You don’t have permission to chat'
                : 'Message…'
          }
          style={{ flex: 1, minWidth: 0, fontSize: '0.85rem' }}
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!canSend || sending || !draft.trim()}>
          {sending ? <Loader size={14} className="spinning" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}
