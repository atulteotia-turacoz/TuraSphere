import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader, MessageSquare, Send, Trash2, RefreshCw, AlertCircle,
} from 'lucide-react';

// The meeting's discussion, as seen by all three sides of a board.
//
// One component, three callers — the expert on their join token, the client on
// their portal token, and the project team from the meeting page. Each passes
// its own fetcher/poster/deleter; everything else (who may delete what, the
// ordering) is decided by the backend and simply rendered here, so the three
// views of one conversation cannot drift apart.
//
// ONE flat thread, not a card per session. The per-session cards this started
// as read as a second copy of the Agenda tab on every portal.

const styles = `
.sd-card { background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 12px; }
.sd-msg { padding: 10px 12px; border-radius: 10px; background: var(--color-bg);
          border: 1px solid var(--color-border-light); margin-bottom: 8px; }
.sd-msg-mine { background: var(--color-primary-bg); border-color: transparent; }
.sd-del { background: none; border: none; cursor: pointer; color: var(--color-text-light);
          padding: 2px; display: inline-flex; border-radius: 5px; }
.sd-del:hover { color: var(--color-error); background: var(--color-error-bg); }
.sd-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
`;

const muted = { color: 'var(--color-text-secondary)', fontSize: '0.85rem' };

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};

// ── Module scope, deliberately ──────────────────────────────────────────────
// These MUST NOT be declared inside SessionDiscussion. A component declared in
// a render body is a new component *type* on every render, so React unmounts
// the old subtree and mounts a fresh one — which threw focus out of the
// textarea on every keystroke and meant clicking back in for each character.

// A name, a time, and the words. No role labels: the thread is a conversation
// between people who know who each other are, and tagging every line
// EXPERT / CLIENT / PROJECT TEAM read as clutter. Your own comments are tinted
// instead, which is the only distinction that has to be visible at a glance.
function Message({ c, onDelete }) {
  return (
    <div className={c.is_mine ? 'sd-msg sd-msg-mine' : 'sd-msg'}>
      <div className="sd-head">
        <span style={{ fontWeight: 700, fontSize: '0.83rem' }}>{c.author_name}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
          {fmtWhen(c.created_at)}
        </span>
        {c.can_delete && (
          <button className="sd-del" style={{ marginLeft: 'auto' }}
                  onClick={() => onDelete(c)} title="Delete this comment">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div style={{ fontSize: '0.87rem', marginTop: 4, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', lineHeight: 1.5 }}>
        {c.body}
      </div>
    </div>
  );
}

function Composer({ value, onChange, onSubmit, busy, error }) {
  return (
    <>
      {error && (
        <div style={{ color: 'var(--color-error)', fontSize: '0.8rem', marginBottom: 6 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
        <textarea
          className="form-control" rows={3}
          placeholder="Write a message to the board…"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(); }}
          style={{ resize: 'vertical', flex: 1 }}
        />
        <button className="btn btn-primary" onClick={onSubmit}
                disabled={busy || !value.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {busy ? <Loader size={14} className="spinning" /> : <Send size={14} />}
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </>
  );
}

export default function SessionDiscussion({
  fetcher,
  onPost,
  onDelete,
  title = 'Discussion',
  subtitle = 'Everything posted here is visible to the expert panel, the client and the project team.',
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The draft lives outside `data` on purpose: the thread refreshes itself
  // every 30s, and a half-typed comment must survive that.
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    try {
      const res = await fetcher();
      setData(res.data);
      setError('');
    } catch (e) {
      if (e.response?.status === 403) setError('You do not have access to this discussion.');
      else setError(e.response?.data?.detail || 'Could not load the discussion.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetcher]);

  useEffect(() => { load({ quiet: true }); }, [load]);

  // A discussion is only useful if a reply turns up without a page reload.
  // Paused while the tab is hidden so a portal left open overnight is not
  // polling all night.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) load({ quiet: true });
    }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const post = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true); setPostError('');
    try {
      // null: the comment belongs to the meeting, not to one session.
      await onPost(null, text);
      setDraft('');
      await load({ quiet: true });
    } catch (e) {
      setPostError(e.response?.data?.detail || 'Could not post your comment.');
    } finally {
      setBusy(false);
    }
  }, [draft, onPost, load]);

  const remove = useCallback(async (comment) => {
    if (!window.confirm('Delete this comment?')) return;
    setPostError('');
    try {
      // Addressed by comment id alone — the flat thread does not need to know
      // which session a row came from before it can delete it.
      await onDelete(null, comment.id);
      await load({ quiet: true });
    } catch (e) {
      setPostError(e.response?.data?.detail || 'Could not delete the comment.');
    }
  }, [onDelete, load]);

  if (loading) {
    return (
      <div className="sd-card" style={{ padding: 36, display: 'flex', justifyContent: 'center', gap: 9, alignItems: 'center' }}>
        <style>{styles}</style>
        <Loader size={15} className="spinning" /> <span style={muted}>Loading discussion…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="sd-card" style={{ padding: 18, color: 'var(--color-error)', display: 'flex', gap: 8 }}>
        <style>{styles}</style>
        <AlertCircle size={16} /> {error}
      </div>
    );
  }
  if (!data) return null;

  const { thread = [], me, can_post: canPost } = data;

  return (
    <div>
      <style>{styles}</style>

      <div className="sd-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="sd-head" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
            <MessageSquare size={16} /> {title}
            <span style={{ ...muted, fontWeight: 400 }}>({data.total_comments})</span>
          </h3>
          <button onClick={() => load()} disabled={refreshing} title="Refresh"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none',
                           border: '1px solid var(--color-border)', borderRadius: 7, padding: '5px 10px',
                           fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                           color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={13} className={refreshing ? 'spinning' : undefined} /> Refresh
          </button>
        </div>
        <p style={{ ...muted, fontSize: '0.8rem', margin: '8px 0 0' }}>{subtitle}</p>
        {me?.name && canPost && (
          <p style={{ ...muted, fontSize: '0.78rem', margin: '4px 0 0' }}>
            You are posting as <strong style={{ color: 'var(--color-text)' }}>{me.name}</strong>.
          </p>
        )}
      </div>

      <div className="sd-card" style={{ padding: 16 }}>
        {thread.length === 0 ? (
          <div style={{ ...muted, fontSize: '0.85rem' }}>
            Nothing here yet{canPost ? ' — start the discussion below.' : '.'}
          </div>
        ) : thread.map(c => <Message key={c.id} c={c} onDelete={remove} />)}

        {canPost && (
          <Composer value={draft} onChange={setDraft} onSubmit={post}
                    busy={busy} error={postError} />
        )}
      </div>
    </div>
  );
}
