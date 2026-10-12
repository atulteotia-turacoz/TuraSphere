import React, { useEffect, useState, useCallback } from 'react';
import { Download, Loader, X } from 'lucide-react';

/**
 * Reads a shared document in the browser instead of downloading it.
 *
 * One component for both sides of the product — the client portal and the
 * team's board/meeting workspace — because "can I just look at it?" is the same
 * question, and two viewers would drift apart.
 *
 * `fetchBlob()` is passed in rather than a URL: both portals authenticate (a
 * bearer token, or the client portal's session header), so a plain `iframe src`
 * would be rejected. The blob becomes an object URL, revoked on close.
 *
 * `kind` comes from the server's `preview_kind`: 'image' renders an <img>,
 * anything else a PDF in an iframe (Word/PowerPoint/Excel are converted
 * server-side, so they arrive here as PDF).
 */
export default function DocumentPreviewModal({ doc, kind, fetchBlob, onClose, onDownload }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let revoked = false;
    let objectUrl = null;
    (async () => {
      try {
        const res = await fetchBlob();
        const type = res.data.type || (kind === 'image' ? doc.mime_type : 'application/pdf');
        objectUrl = window.URL.createObjectURL(new Blob([res.data], { type }));
        if (!revoked) setUrl(objectUrl);
      } catch (e) {
        // The response body is a blob even on an error, so the message has to
        // be read out of it rather than off `detail` directly.
        let msg = 'Preview is not available for this file. Download it instead.';
        try { msg = JSON.parse(await e.response?.data?.text())?.detail || msg; } catch { /* keep default */ }
        if (!revoked) setErr(msg);
      }
    })();
    return () => {
      revoked = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [doc, kind, fetchBlob]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const subtitle = [doc.section_title, doc.session_title].filter(Boolean).join(' · ');

  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{
        width: 'min(1000px, 100%)', height: 'min(90vh, 100%)', padding: 0,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
            {subtitle && <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{subtitle}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {onDownload && (
              <button className="btn btn-sm btn-ghost" onClick={onDownload}><Download size={14} /> Download</button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={close} aria-label="Close preview"><X size={14} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
          {err ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '0.86rem' }}>{err}</div>
          ) : !url ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '0.86rem' }}>
              <Loader size={22} className="spinning" />
              <div style={{ marginTop: 8 }}>Preparing the preview…</div>
            </div>
          ) : kind === 'image' ? (
            <img src={url} alt={doc.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <iframe src={url} title={doc.title} style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </div>
      </div>
    </div>
  );
}

// Documents grouped by section (folder), in section order, with anything
// unfiled last. One helper for both portals so the client and the experts see
// the same structure.
export function groupBySection(docs) {
  const groups = new Map();
  for (const d of docs || []) {
    const key = d.section_id ?? (d.section_title ? `t:${d.section_title}` : 'none');
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: d.section_title || null,
        sequence: d.section_sequence ?? Number.MAX_SAFE_INTEGER,
        docs: [],
      });
    }
    groups.get(key).docs.push(d);
  }
  return [...groups.values()].sort((a, b) => {
    // Unfiled material sits at the bottom whatever its sequence says.
    if (!a.title !== !b.title) return a.title ? -1 : 1;
    return a.sequence - b.sequence;
  });
}
