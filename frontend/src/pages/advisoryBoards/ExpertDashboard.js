import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader, MapPin, Calendar, Clock, Users, FileText, Download, MessageSquare,
  ClipboardList, ExternalLink, Send, Trash2, CheckCircle2, Award, Building2,
  Stethoscope, FileSpreadsheet, Presentation, ArrowRight, Eye, X,
} from 'lucide-react';
import {
  getExpertDashboard, downloadJoinMaterial, addSessionComment, deleteSessionComment,
  openJoinMaterial, heartbeatJoinMaterial, getJoinMaterialInline,
} from '../../services/api';

// The invited expert's landing page, to the spec in "KOL dashboard Advisory
// Board-Dr Shruti".
//
// Layout: a hero that introduces the expert to themselves, then two columns —
// the things they're meant to ACT on (read the material, leave comments) get
// the wide left column, while the things they only need to REFER to (when,
// where, who else, the survey) sit in a sticky right rail. The doc lists those
// reference items first, but reading order isn't screen order: material and
// discussion is the bulk of the page and the reason they came.

const styles = `
.ed-wrap { --ed-gap: 16px; }
.ed-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--ed-gap); align-items: start; }
@media (max-width: 900px) { .ed-grid { grid-template-columns: minmax(0, 1fr); } .ed-rail { position: static !important; } }
.ed-card { background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 12px; }
.ed-rail { position: sticky; top: 16px; display: flex; flex-direction: column; gap: var(--ed-gap); }
.ed-doc { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 8px;
          border: 1px solid var(--color-border-light); background: var(--color-bg); margin-bottom: 7px; }
.ed-doc:hover { border-color: var(--color-primary); }
.ed-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
           font-size: 0.83rem; background: var(--color-surface-raised); border: 1px solid var(--color-border-light); }
.ed-num { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
          border-radius: 8px; background: var(--color-primary); color: var(--color-primary-contrast);
          font-size: 0.78rem; font-weight: 700; flex-shrink: 0; }
.ed-lbl { font-size: 0.68rem; text-transform: uppercase; letter-spacing: .05em;
          color: var(--color-text-light); font-weight: 700; }
.ed-ta { width: 100%; resize: vertical; padding: 9px 11px; font-size: 0.86rem; font-family: inherit;
         border-radius: 8px; border: 1px solid var(--color-border); background: var(--color-surface);
         color: var(--color-text); box-sizing: border-box; }
.ed-ta:focus { outline: none; border-color: var(--color-primary); }
`;

const muted = { color: 'var(--color-text-secondary)', fontSize: '0.85rem' };

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Slides vs spreadsheet vs everything else — the spec calls out both by name,
// so they should be tellable apart at a glance.
const docIcon = (doc) => {
  const t = `${doc.mime_type || ''} ${doc.title || ''}`.toLowerCase();
  if (/sheet|excel|\.xls|\.csv/.test(t)) return FileSpreadsheet;
  if (/presentation|powerpoint|\.ppt|slide/.test(t)) return Presentation;
  return FileText;
};

export default function ExpertDashboard({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);   // document open in the viewer

  const load = useCallback(async () => {
    try {
      const res = await getExpertDashboard(token);
      setData(res.data);
      setError('');
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not load your dashboard.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="ed-card" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: 40 }}>
        <style>{styles}</style>
        <Loader size={16} className="spin" /> <span style={muted}>Loading your dashboard…</span>
      </div>
    );
  }
  if (error) return <div className="ed-card" style={{ padding: 18, color: 'var(--color-error)' }}>{error}</div>;
  if (!data) return null;

  const { profile, details, experts, sessions, sections = [], other_documents: other, surveys } = data;
  const name = profile.name || 'Doctor';
  const hasProfile = profile.affiliations || profile.years_of_experience != null;

  return (
    <div className="ed-wrap">
      <style>{styles}</style>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="ed-card" style={{ padding: 22, marginBottom: 16, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{
          width: 60, height: 60, borderRadius: 16, flexShrink: 0,
          background: 'var(--color-primary)', color: 'var(--color-primary-contrast)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.25rem', fontWeight: 700, letterSpacing: '.02em',
        }}>{initials(name)}</div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', fontWeight: 600 }}>Welcome</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, lineHeight: 1.2 }}>{name}</div>
          {(profile.designation || profile.specialty || profile.organization) && (
            <div style={{ ...muted, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Stethoscope size={12} />
              {[profile.designation, profile.specialty, profile.organization].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        {/* Affiliations / Years of Experience — only a KOL-linked participant has
            these, so the hero simply tightens up for anyone else. */}
        {hasProfile && (
          <div style={{
            display: 'flex', gap: 22, flexWrap: 'wrap', paddingLeft: 18,
            borderLeft: '1px solid var(--color-border-light)', maxWidth: 460,
          }}>
            {profile.affiliations && (
              <div style={{ minWidth: 180, flex: 1 }}>
                <div className="ed-lbl"><Building2 size={10} style={{ verticalAlign: -1 }} /> Affiliations</div>
                <div style={{ fontSize: '0.85rem', marginTop: 3, whiteSpace: 'pre-line', lineHeight: 1.45 }}>
                  {profile.affiliations}
                </div>
              </div>
            )}
            {profile.years_of_experience != null && (
              <div>
                <div className="ed-lbl"><Award size={10} style={{ verticalAlign: -1 }} /> Experience</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 1, lineHeight: 1.1 }}>
                  {profile.years_of_experience}
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-light)' }}> yrs</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ed-grid">
        {/* ── Main column ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          {/* Invitation note */}
          <div className="ed-card" style={{ padding: 20, borderLeft: '3px solid var(--color-primary)' }}>
            <p style={{ margin: '0 0 10px', fontWeight: 600 }}>Dear {name},</p>
            <p style={{ margin: '0 0 10px', lineHeight: 1.65, fontSize: '0.92rem' }}>
              You are invited to participate in the advisory board meeting on the topic
              {' '}<strong>“{details.topic}”</strong>. Please find below the details of the meeting
              and the reading material for your reference. You will also find the details of the
              other experts for this meeting here.
            </p>
            <p style={{ margin: 0, lineHeight: 1.65, fontSize: '0.92rem', ...muted }}>
              We hope you can access the reading material below. Please feel free to add your
              thoughts in the comments section — we will take these up during the meeting.
            </p>
          </div>

          {/* Meeting material, one block per session */}
          <div>
            <h3 style={{ margin: '0 0 10px', fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: 7 }}>
              <FileText size={16} /> Meeting material
            </h3>

            {sessions.length === 0 && sections.length === 0 && other.length === 0 && (
              <div className="ed-card" style={{ padding: 20, ...muted }}>
                The reading material will appear here once it is shared with you.
              </div>
            )}

            {/* Filed by section, each document showing which session it belongs
                to. The blocks below are agenda sessions, which carry their own
                discussion — a document filed before sections existed still
                appears there. */}
            {sections.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
                {sections.map(sec => (
                  <div key={sec.id} className="ed-card" style={{ padding: 16 }}>
                    <div className="ed-lbl" style={{ marginBottom: 8 }}>{sec.title}</div>
                    {sec.documents.map(d => (
                      <DocRow key={d.id} doc={d} token={token}
                              canDownload={data.can_download_documents} onOpen={setViewing} />
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sessions.map((s, i) => (
                <SessionBlock key={s.id} token={token} session={s} index={i + 1}
                              canDownload={data.can_download_documents}
                              canComment={data.can_comment}
                              onOpen={setViewing}
                              onChanged={load} />
              ))}
            </div>

            {other.length > 0 && (
              <div className="ed-card" style={{ padding: 16, marginTop: 12 }}>
                <div className="ed-lbl" style={{ marginBottom: 8 }}>Other material</div>
                {other.map(d => <DocRow key={d.id} doc={d} token={token} canDownload={data.can_download_documents} onOpen={setViewing} />)}
              </div>
            )}
          </div>
        </div>

        {/* ── Sticky reference rail ────────────────────────────────────── */}
        <div className="ed-rail">
          <div className="ed-card" style={{ padding: 16 }}>
            <div className="ed-lbl" style={{ marginBottom: 10 }}>Meeting details</div>
            <Fact icon={ClipboardList} title="Agenda" value={details.agenda_summary || details.meeting_title} />
            <Fact icon={Calendar} title="Save the date" value={fmtDate(details.save_the_date) || 'To be confirmed'} />
            <Fact icon={Clock} title="Time"
                  value={details.time ? `${details.time}${details.end_time ? ` – ${details.end_time}` : ''}` : 'To be confirmed'} />
            <Fact icon={MapPin} title="Venue"
                  value={details.venue || (details.format === 'virtual' ? 'Virtual meeting' : 'To be confirmed')}
                  link={details.venue_map_url} linkLabel="View on Google Maps" last />
          </div>

          <div className="ed-card" style={{ padding: 16 }}>
            <div className="ed-lbl" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Users size={11} /> Experts {experts.length > 0 && <span style={{ opacity: .7 }}>({experts.length + 1})</span>}
            </div>
            {experts.length === 0 ? (
              <div style={{ ...muted, fontSize: '0.8rem' }}>The panel will appear here once confirmed.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {experts.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--color-surface-raised)', border: '1px solid var(--color-border-light)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.64rem', fontWeight: 700, color: 'var(--color-text-secondary)',
                    }}>{initials(e.name)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.83rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.profile_path ? (
                          <a href={e.profile_path} target="_blank" rel="noreferrer"
                             style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{e.name}</a>
                        ) : e.name}
                      </div>
                      {e.organization && (
                        <div style={{ fontSize: '0.71rem', color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.organization}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {surveys.length > 0 && (
            <div className="ed-card" style={{ padding: 16 }}>
              <div className="ed-lbl" style={{ marginBottom: 10 }}>Survey</div>
              {surveys.map(s => (
                <div key={s.token} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', marginBottom: 6 }}>
                    {s.phase === 'pre' ? 'Pre-meeting survey' : 'Post-meeting survey'}
                  </div>
                  {s.responded ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--color-success)', fontSize: '0.8rem', fontWeight: 600 }}>
                      <CheckCircle2 size={13} /> Completed
                    </span>
                  ) : (
                    <a className="btn btn-sm btn-primary" href={`/survey/${s.token}`} target="_blank" rel="noreferrer"
                       style={{ width: '100%', justifyContent: 'center' }}>
                      Open survey <ArrowRight size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewing && <DocViewer token={token} doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Fact({ icon: Icon, title, value, link, linkLabel, last }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '9px 0',
      borderBottom: last ? 'none' : '1px solid var(--color-border-light)',
    }}>
      <Icon size={14} style={{ color: 'var(--color-text-light)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '0.87rem', marginTop: 1, lineHeight: 1.4 }}>{value}</div>
        {link && (
          <a href={link} target="_blank" rel="noreferrer"
             style={{ fontSize: '0.75rem', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
            {linkLabel} <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

function DocRow({ doc, token, canDownload, onOpen }) {
  const [busy, setBusy] = useState(false);
  const Icon = docIcon(doc);
  const download = async () => {
    setBusy(true);
    try {
      const res = await downloadJoinMaterial(token, doc.id);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = doc.title || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* the button simply stays available */ }
    finally { setBusy(false); }
  };
  return (
    <div className="ed-doc">
      <Icon size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.title}
        </div>
        {doc.session_title && (
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
            {doc.session_title}
          </div>
        )}
      </div>
      <button className="btn btn-sm btn-ghost" onClick={() => onOpen(doc)} title="Open">
        <Eye size={13} />
      </button>
      {canDownload && (
        <button className="btn btn-sm btn-ghost" onClick={download} disabled={busy} title="Download">
          <Download size={13} />
        </button>
      )}
    </div>
  );
}

// Reads a document in-portal and times it. The timing is the whole point: the
// organizer's dashboard asks how long experts spent on each section's material,
// and a download tells us nothing about that.
// Exported: the Materials tab opens the same viewer, so reading a document
// counts the same way wherever it was opened from.
export function DocViewer({ token, doc, onClose }) {
  const [state, setState] = useState({ status: 'loading', url: null, viewId: null });

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let objectUrl = null;
    const startedAt = Date.now();

    openJoinMaterial(token, doc.id)
      .then(async (res) => {
        if (cancelled) return;
        const viewId = res.data.view_id;
        // Elapsed-since-open, not a delta, so a dropped beat corrects itself.
        timer = setInterval(() => {
          heartbeatJoinMaterial(token, viewId, Math.round((Date.now() - startedAt) / 1000))
            .catch(() => { /* a missed beat is made up by the next one */ });
        }, 15000);

        const file = await getJoinMaterialInline(token, doc.id);
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(
          new Blob([file.data], { type: file.data.type || doc.mime_type || 'application/pdf' }),
        );
        setState({ status: 'ready', url: objectUrl, viewId, isImage: (file.data.type || '').startsWith('image/') });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', url: null, viewId: null }); });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
      // Final beat on close, so a read shorter than one interval still counts.
      setState(s => {
        if (s.viewId) {
          heartbeatJoinMaterial(token, s.viewId, Math.round((Date.now() - startedAt) / 1000)).catch(() => {});
        }
        return s;
      });
    };
    // doc.mime_type is only a fallback for the blob's own type; re-opening the
    // viewer when it changes would restart the read timer for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, doc.id]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.62)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--color-surface)', borderRadius: 12, width: 'min(1000px, 100%)',
        height: 'min(88vh, 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={15} style={{ color: 'var(--color-primary)' }} />
          <div style={{ fontWeight: 700, fontSize: '0.92rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.title}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: 'var(--color-bg)' }}>
          {state.status === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, ...muted }}>
              <Loader size={15} className="spin" /> Opening…
            </div>
          )}
          {state.status === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-error)' }}>
              This document could not be opened.
            </div>
          )}
          {state.status === 'ready' && (
            state.isImage
              ? <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
                  <img src={state.url} alt={doc.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
              : <iframe title={doc.title} src={state.url} style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </div>
        <div style={{ padding: '9px 16px', borderTop: '1px solid var(--color-border-light)', ...muted, fontSize: '0.76rem' }}>
          Word, PowerPoint and Excel files are shown as PDF. Use Download for the original.
        </div>
      </div>
    </div>
  );
}

// One session: its agenda, its documents, and its own discussion forum.
function SessionBlock({ token, session, index, canDownload, canComment, onOpen, onChanged }) {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  const count = session.comments.length;
  // The forum opens by itself when there is a conversation to see; an empty one
  // stays folded so three sessions don't push the material off the screen.
  const showForum = open || count > 0;

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setPosting(true); setErr('');
    try {
      await addSessionComment(token, session.id, text);
      setBody('');
      onChanged();
    } catch (e) { setErr(e.response?.data?.detail || 'Could not post your comment.'); }
    finally { setPosting(false); }
  };

  const remove = async (c) => {
    if (!window.confirm('Delete your comment?')) return;
    try { await deleteSessionComment(token, session.id, c.id); onChanged(); }
    catch (e) { setErr(e.response?.data?.detail || 'Could not delete the comment.'); }
  };

  return (
    <div className="ed-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <span className="ed-num">{index}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3 }}>{session.title}</div>
          {session.description && (
            <div style={{ ...muted, marginTop: 3, whiteSpace: 'pre-line', fontSize: '0.82rem' }}>{session.description}</div>
          )}
        </div>
        {session.duration_minutes && (
          <span style={{ ...muted, fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={11} /> {session.duration_minutes} min
          </span>
        )}
      </div>

      <div style={{ padding: '12px 16px' }}>
        {session.documents.length === 0 ? (
          <div style={{ ...muted, fontSize: '0.8rem' }}>No material shared for this session yet.</div>
        ) : session.documents.map(d => (
          <DocRow key={d.id} doc={d} token={token} canDownload={canDownload} onOpen={onOpen} />
        ))}
      </div>

      {/* Discussion forum for this session */}
      <div style={{ padding: '0 16px 14px' }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: showForum ? 9 : 0,
            color: 'var(--color-text-secondary)', fontSize: '0.78rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
          <MessageSquare size={12} /> Discussion
          {count > 0 && (
            <span style={{
              background: 'var(--color-primary)', color: 'var(--color-primary-contrast)',
              borderRadius: 999, padding: '0 6px', fontSize: '0.68rem',
            }}>{count}</span>
          )}
        </button>

        {showForum && (
          <>
            {count === 0 && (
              <div style={{ ...muted, fontSize: '0.8rem', marginBottom: 8 }}>
                No comments yet — yours would be the first.
              </div>
            )}
            {session.comments.map(c => (
              <div key={c.id} style={{
                padding: '9px 11px', marginBottom: 6, borderRadius: 8,
                background: c.is_mine ? 'var(--color-primary-bg)' : 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{c.author_name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
                    {c.created_at ? new Date(c.created_at).toLocaleString() : ''}
                  </span>
                  {c.is_mine && (
                    <button onClick={() => remove(c)} title="Delete your comment"
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-light)', padding: 2 }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '0.86rem', marginTop: 3, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{c.body}</div>
              </div>
            ))}

            {canComment && (
              <div style={{ marginTop: 8 }}>
                <textarea className="ed-ta" value={body} onChange={e => setBody(e.target.value)}
                          placeholder="Add your thoughts on this session…" rows={2} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn btn-sm btn-primary" onClick={post} disabled={posting || !body.trim()}>
                    <Send size={12} /> {posting ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </div>
            )}
            {err && <div style={{ color: 'var(--color-error)', fontSize: '0.78rem', marginTop: 5 }}>{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}
