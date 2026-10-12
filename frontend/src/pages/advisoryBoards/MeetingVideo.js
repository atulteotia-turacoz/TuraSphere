import React, { useEffect, useRef, useState } from 'react';
import { Loader, AlertCircle, ExternalLink, X } from 'lucide-react';
import { getMeetingSdkSignature } from '../../services/api';

// Zoom Meeting SDK (Component View) loaded from Zoom's CDN at runtime. The
// Component-View bundle externalizes React/ReactDOM, so we load Zoom's
// version-matched vendor copies first, then the SDK bundle (which sets
// window.ZoomMtgEmbedded).
const ZOOM_SDK_VERSION = '6.1.0';
const ZOOM_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}`;

// Zoom's Component View renders its whole UI — video gallery *and* its own
// toolbar — into a fixed-size box inside our root. `customize.video.viewSizes`
// is meant to size that box, but this SDK version ignores it and falls back to a
// small default view, which left the meeting as a ~250px card floating in the
// top-left of an otherwise empty page. These rules force the injected wrapper to
// fill our container instead. They are deliberately shallow — only the root's
// own descendants, addressed by Zoom's stable `zmwebsdk-` class prefix rather
// than the hashed suffixes — so a future SDK restyle degrades back to the small
// box rather than breaking the embed.
const FILL_STYLE_ID = 'zoom-embed-fill-style';
const FILL_CSS = `
[data-zoom-embed-root] > div {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
[data-zoom-embed-root] > div > [class*="zmwebsdk-MuiBox-root"] {
  max-width: none !important;
}
[data-zoom-embed-root] canvas,
[data-zoom-embed-root] video {
  max-width: 100% !important;
  max-height: 100% !important;
}
`;

function ensureFillStyle() {
  if (document.getElementById(FILL_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = FILL_STYLE_ID;
  s.textContent = FILL_CSS;
  document.head.appendChild(s);
}

// TEMPORARY (dev only): prints the DOM Zoom injects, so we can see which element
// caps the embed's height instead of guessing at CSS. The SDK builds this tree at
// runtime with hashed class names, so it can't be read from source. Remove once
// the embed sizes correctly.
function logEmbedLayout(root, client) {
  if (process.env.NODE_ENV === 'production' || !root) return;
  try {
    const stream = client?.getMediaStream?.();
    /* eslint-disable no-console */
    console.groupCollapsed('%c[MeetingVideo] embed layout', 'color:var(--color-primary);font-weight:bold');
    console.log('crossOriginIsolated:', window.crossOriginIsolated,
      '| SharedArrayBuffer:', typeof SharedArrayBuffer !== 'undefined');
    console.log('multi-video supported:', stream?.isSupportMultipleVideos?.());
    console.log('root box:', root.getBoundingClientRect().width + '×' + root.getBoundingClientRect().height);
    (function walk(el, depth) {
      if (!el || depth > 6) return;
      const r = el.getBoundingClientRect();
      console.log(
        '  '.repeat(depth) + el.tagName.toLowerCase()
        + (el.className ? '.' + String(el.className).slice(0, 55) : '')
        + ` → ${Math.round(r.width)}×${Math.round(r.height)}`
        + (el.style?.height ? ` [inline h=${el.style.height}]` : '')
      );
      Array.from(el.children).forEach((c) => walk(c, depth + 1));
    })(root, 0);
    console.groupEnd();
    /* eslint-enable no-console */
  } catch { /* diagnostics must never break the meeting */ }
}

function loadScript(id, src) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.async = false;
    s.crossOrigin = 'anonymous';
    s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

async function loadZoomEmbedded() {
  if (window.ZoomMtgEmbedded) return window.ZoomMtgEmbedded;
  if (!window.React) await loadScript('zoom-vendor-react', `${ZOOM_BASE}/lib/vendor/react.min.js`);
  if (!window.ReactDOM) await loadScript('zoom-vendor-react-dom', `${ZOOM_BASE}/lib/vendor/react-dom.min.js`);
  await loadScript('zoom-embedded-sdk', `${ZOOM_BASE}/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`);
  return window.ZoomMtgEmbedded;
}

// Fills its parent with the in-app Zoom call. Falls back to the external Zoom
// link if in-app join isn't configured (no Meeting SDK Key/Secret) or errors.
// `fetchSignature` returns a promise of { data: {signature, sdk_key, ...} }.
// Defaults to the authenticated endpoint keyed by `meetingId`; the public
// participant portal passes a token-based fetcher instead. `sessionKey` keys the
// join effect (meetingId or token). `fallbackUrl` is the caller's known external
// join link — needed because a failing signature call returns no link of its own.
//
// Controls are Zoom's own toolbar, rendered inside the embed. We deliberately do
// NOT draw a second control bar: having ours below Zoom's meant two stacked UIs
// with two mute buttons and two (disagreeing) participant counts.
export default function MeetingVideo({ meetingId, fetchSignature, sessionKey, onLeave, fallbackUrl: fallbackUrlProp }) {
  const rootRef = useRef(null);
  const clientRef = useRef(null);
  const sdkRef = useRef(null);
  const onLeaveRef = useRef(onLeave);
  const [phase, setPhase] = useState('loading');   // loading | joining | joined | error
  const [err, setErr] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');
  // Set when the backend granted host role but Zoom withheld the ZAK — the
  // meeting still works, you just have no host controls. Dismissible.
  const [hostWarning, setHostWarning] = useState('');

  // Kept in a ref so a caller passing an inline arrow doesn't re-run the join
  // effect (which would leave and rejoin the meeting) on every render.
  useEffect(() => { onLeaveRef.current = onLeave; }, [onLeave]);

  useEffect(() => {
    let cancelled = false;
    ensureFillStyle();

    (async () => {
      let cfg;
      try {
        const r = fetchSignature ? await fetchSignature() : await getMeetingSdkSignature(meetingId);
        cfg = r.data;
        if (cfg.join_url) setFallbackUrl(cfg.join_url);
        if (cfg.host_warning) setHostWarning(cfg.host_warning);
      } catch (e) {
        if (cancelled) return;
        setErr(e.response?.data?.detail || e.message || 'Could not start the in-app meeting.');
        setPhase('error');
        return;
      }

      try {
        setPhase('joining');
        const ZoomMtgEmbedded = await loadZoomEmbedded();
        sdkRef.current = ZoomMtgEmbedded;
        if (cancelled) return;

        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;

        // Ask for the full container. The CSS above is what actually makes it
        // fill, but pass real numbers too so we get the right size on any SDK
        // build that does honour viewSizes.
        const rect = rootRef.current?.getBoundingClientRect();
        const w = Math.max(320, Math.floor(rect?.width || window.innerWidth));
        const h = Math.max(240, Math.floor(rect?.height || (window.innerHeight - 120)));

        await client.init({
          zoomAppRoot: rootRef.current,
          language: 'en-US',
          patchJsMedia: true,
          customize: {
            video: {
              // false makes `viewSizes` authoritative. With true the SDK keeps
              // its own resizable box and ignores the sizes we pass, which is
              // what left the embed a short strip with its toolbar cut off.
              isResizable: false,
              // `default` is the normal gallery/speaker view; `ribbon` is the thin
              // strip the SDK switches to while someone shares their screen. Only
              // `default` was set before, so the ribbon fell back to SDK defaults.
              viewSizes: {
                default: { width: w, height: h },
                ribbon: { width: Math.min(300, w), height: h },
              },
            },
          },
        });
        if (cancelled) return;

        await client.join({
          sdkKey: cfg.sdk_key,
          signature: cfg.signature,
          meetingNumber: cfg.meeting_number,
          password: cfg.password || '',
          userName: cfg.user_name || 'Guest',
          userEmail: cfg.user_email || undefined,
          zak: cfg.zak || undefined,
        });
        if (cancelled) return;

        // Zoom's toolbar owns Leave now, so the surrounding page only finds out
        // the meeting ended by listening for it.
        try {
          client.on('connection-change', (payload) => {
            if (payload?.state === 'Closed') onLeaveRef.current?.();
          });
        } catch { /* older SDK */ }

        // Promote moderators to Zoom co-host. Only the host can do this, and
        // only in-meeting — Zoom's signature has no co-host role, so the backend
        // sends the roster (`cohost_names`) and we act on it here as people
        // arrive. Co-host, not host: they get mute/manage but cannot start cloud
        // recording, which stays with the organizer.
        if (cfg.role === 1 && Array.isArray(cfg.cohost_names) && cfg.cohost_names.length) {
          const wanted = new Set(cfg.cohost_names.map((n) => String(n).trim().toLowerCase()));
          const promote = () => {
            if (typeof client.makeCoHost !== 'function') return;
            let users = [];
            try { users = client.getAllUser() || []; } catch { return; }
            users.forEach((u) => {
              if (u.isHost || u.isCoHost || u.isCurrentUser) return;
              if (!wanted.has(String(u.displayName || '').trim().toLowerCase())) return;
              // Fails harmlessly if the SDK rejects it (e.g. we lost host role).
              try { client.makeCoHost(u.userId); } catch { /* ignore */ }
            });
          };
          promote();
          try {
            client.on('user-added', promote);
            client.on('user-updated', promote);
          } catch { /* older SDK */ }
        }

        setPhase('joined');
        logEmbedLayout(rootRef.current, client);
      } catch (e) {
        if (cancelled) return;
        setErr(e?.reason || e?.message || 'Failed to join the meeting in-app.');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      try { clientRef.current?.leaveMeeting?.(); } catch { /* ignore */ }
      try { clientRef.current?.leave?.(); } catch { /* ignore */ }
      try { sdkRef.current?.destroyClient?.(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, sessionKey]);

  // Prefer the link the signature call returned; fall back to the caller's copy,
  // which is the only one available when that call is what failed. Read at render
  // rather than seeded into state so a caller that loads the meeting
  // asynchronously (MeetingRoomPage) still supplies it after mount.
  const escapeHatchUrl = fallbackUrl || fallbackUrlProp || '';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--color-text)', overflow: 'hidden' }}>
      <div ref={rootRef} data-zoom-embed-root style={{ width: '100%', height: '100%' }} />

      {hostWarning && phase === 'joined' && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
          maxWidth: '92%', display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'var(--color-warning-text)', color: 'var(--color-warning-bg)', borderRadius: 8, padding: '8px 12px',
          fontSize: '0.78rem', boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
        }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{hostWarning}</span>
          <button onClick={() => setHostWarning('')} title="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--color-warning-bg)', cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {(phase === 'loading' || phase === 'joining') && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--color-border)' }}>
          <Loader size={30} className="spinning" />
          <span style={{ fontSize: '0.9rem' }}>{phase === 'loading' ? 'Preparing the meeting…' : 'Joining…'}</span>
        </div>
      )}

      {phase === 'error' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ maxWidth: 460, width: '92%', padding: 22, textAlign: 'center' }}>
            <AlertCircle size={28} style={{ color: 'var(--color-warning)', margin: '0 auto 10px' }} />
            <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>Can't join in-app</h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>{err}</p>
            {escapeHatchUrl && (
              <a className="btn btn-primary" href={escapeHatchUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Open in Zoom instead
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
