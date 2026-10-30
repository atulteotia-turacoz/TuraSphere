import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader, Users, Eye, EyeOff, CheckCircle2, Clock, MessageSquare,
  ClipboardList, MapPin, Calendar, ExternalLink, BookOpen, AlertTriangle,
} from 'lucide-react';
import NpsSummary from '../../components/NpsSummary';

// The dashboard for the manager / organiser / Turacoz and the client, to the
// spec in "KOL dashboard Advisory Board-Dr Shruti".
//
// One component, two callers: the organizer reads it through
// GET /meetings/{id}/engagement, the client through the client-portal route.
// Both are served by the same backend roll-up, so the numbers cannot diverge.

const styles = `
.eg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.eg-card { background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 12px; }
.eg-two { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
@media (max-width: 940px) { .eg-two { grid-template-columns: minmax(0, 1fr); } }
.eg-bar { height: 8px; border-radius: 999px; background: var(--color-surface-raised); overflow: hidden; }
.eg-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--color-primary); }
.eg-lbl { font-size: 0.68rem; text-transform: uppercase; letter-spacing: .05em;
          color: var(--color-text-light); font-weight: 700; }
.eg-name { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.78rem;
           background: var(--color-surface-raised); border: 1px solid var(--color-border-light); margin: 0 4px 4px 0; }
`;

const muted = { color: 'var(--color-text-secondary)', fontSize: '0.85rem' };

// Seconds are the wrong unit for a human reading a report — "4m 20s", not "260".
const fmtDuration = (sec) => {
  if (sec == null) return null;
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export default function EngagementDashboard({ fetcher, showSurveys = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetcher();
      setData(res.data);
      setError('');
    } catch (e) {
      if (e.response?.status === 403) setError('You do not have access to this meeting’s engagement data.');
      else setError(e.response?.data?.detail || 'Could not load engagement data.');
    } finally { setLoading(false); }
  }, [fetcher]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="eg-card" style={{ padding: 36, display: 'flex', justifyContent: 'center', gap: 9, alignItems: 'center' }}>
        <style>{styles}</style>
        <Loader size={15} className="spin" /> <span style={muted}>Loading engagement…</span>
      </div>
    );
  }
  if (error) return <div className="eg-card" style={{ padding: 18, color: 'var(--color-error)' }}>{error}</div>;
  if (!data) return null;

  const { details, experts, summary: sm, sections, surveys } = data;
  const noData = sm.total_experts === 0;

  return (
    <div>
      <style>{styles}</style>

      {/* Meeting particulars — the same block the expert sees */}
      <div className="eg-card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="eg-grid">
          <Fact icon={ClipboardList} title="Meeting agenda" value={details.agenda_summary || details.meeting_title} />
          <Fact icon={Calendar} title="Save the date" value={fmtDate(details.save_the_date) || 'To be confirmed'} />
          <Fact icon={Clock} title="Time"
                value={details.time ? `${details.time} · ${details.duration_minutes || 60} min` : 'To be confirmed'} />
          <Fact icon={MapPin} title="Venue"
                value={details.venue || (details.format === 'virtual' ? 'Virtual meeting' : 'To be confirmed')}
                link={details.venue_map_url} linkLabel="Google Maps" />
        </div>
      </div>

      {noData ? (
        <div className="eg-card" style={{ padding: 20, ...muted }}>
          No experts have been invited to this meeting yet — engagement figures appear once the panel is in place.
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="eg-grid" style={{ marginBottom: 16 }}>
            <Stat label="Experts invited" value={sm.total_experts} icon={Users} />
            <Stat label="Referred to the material" value={sm.referred_any_count}
                  sub={`${sm.referred_any_pct}% of the panel`} pct={sm.referred_any_pct} icon={BookOpen} />
            <Stat label="Read every section" value={sm.all_sections_count}
                  sub={sm.sections_with_documents ? `of ${sm.sections_with_documents} section(s) with material` : 'no material uploaded yet'}
                  icon={CheckCircle2} />
            <Stat label="Yet to open anything" value={sm.none_count}
                  tone={sm.none_count > 0 ? 'warn' : undefined} icon={EyeOff} />
          </div>

          <div className="eg-two">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

              {/* Per-section engagement — the graphical representation */}
              <div className="eg-card" style={{ padding: 16 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Eye size={15} /> Expert engagement by section
                </h3>
                <p style={{ ...muted, fontSize: '0.78rem', margin: '0 0 14px' }}>
                  A download counts as referring to the material, but carries no reading time.
                </p>

                {sections.length === 0 ? (
                  <div style={muted}>No sessions have been added to this meeting yet.</div>
                ) : sections.map(sec => (
                  <div key={sec.id} style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{sec.title}</span>
                      <span style={{ ...muted, fontSize: '0.76rem' }}>
                        {sec.document_count} document{sec.document_count === 1 ? '' : 's'}
                      </span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '0.9rem' }}>
                        {sec.opened_count}<span style={{ ...muted, fontWeight: 400 }}> / {sm.total_experts} opened</span>
                      </span>
                    </div>

                    <div className="eg-bar"><span style={{ width: `${sec.opened_pct}%` }} /></div>

                    <div style={{ display: 'flex', gap: 18, marginTop: 7, flexWrap: 'wrap', fontSize: '0.79rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...muted }}>
                        <Clock size={12} />
                        {sec.avg_seconds != null
                          ? <>avg <strong style={{ color: 'var(--color-text)' }}>{fmtDuration(sec.avg_seconds)}</strong> over {sec.timed_expert_count} reader{sec.timed_expert_count === 1 ? '' : 's'}</>
                          : (sec.document_count === 0 ? 'no material uploaded' : 'no reading time recorded')}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...muted }}>
                        <MessageSquare size={12} /> {sec.comment_count} comment{sec.comment_count === 1 ? '' : 's'}
                      </span>
                    </div>

                    {sec.opened_names.length > 0 && (
                      <div style={{ marginTop: 7 }}>
                        <div className="eg-lbl" style={{ marginBottom: 4 }}>Opened by</div>
                        {sec.opened_names.map(n => <span key={n} className="eg-name">{n}</span>)}
                      </div>
                    )}
                    {sec.not_opened_names.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <div className="eg-lbl" style={{ marginBottom: 4 }}>Yet to open</div>
                        {sec.not_opened_names.map(n => (
                          <span key={n} className="eg-name" style={{ color: 'var(--color-text-light)' }}>{n}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Discussion activity, by section, with names */}
              <div className="eg-card" style={{ padding: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <MessageSquare size={15} /> Expert discussion activity
                  <span style={{ ...muted, fontWeight: 400, fontSize: '0.82rem' }}>({sm.total_comments})</span>
                </h3>
                {sm.total_comments === 0 ? (
                  <div style={muted}>No comments on the reading material yet.</div>
                ) : sections.filter(s => s.comment_count > 0).map(sec => (
                  <div key={sec.id} style={{ marginBottom: 14 }}>
                    <div className="eg-lbl" style={{ marginBottom: 6 }}>{sec.title} — {sec.comment_count}</div>
                    {sec.comments.map(c => (
                      <div key={c.id} style={{
                        padding: '9px 11px', marginBottom: 6, borderRadius: 8,
                        background: 'var(--color-bg)', border: '1px solid var(--color-border-light)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{c.expert_name}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
                            {c.created_at ? new Date(c.created_at).toLocaleString() : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.86rem', marginTop: 3, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{c.body}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Survey responses, question by question */}
              {showSurveys && surveys.length > 0 && <SurveyResults surveys={surveys} />}
            </div>

            {/* Rail: the panel, and who needs chasing */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="eg-card" style={{ padding: 16 }}>
                <div className="eg-lbl" style={{ marginBottom: 10 }}>Experts ({experts.length})</div>
                {experts.length === 0 ? (
                  <div style={{ ...muted, fontSize: '0.8rem' }}>No experts invited yet.</div>
                ) : experts.map(e => (
                  <div key={e.id} style={{ padding: '5px 0', fontSize: '0.84rem' }}>
                    {e.profile_path ? (
                      <a href={e.profile_path} target="_blank" rel="noreferrer"
                         style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600 }}>{e.name}</a>
                    ) : <span style={{ fontWeight: 600 }}>{e.name}</span>}
                    {e.organization && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>{e.organization}</div>
                    )}
                  </div>
                ))}
              </div>

              {sm.all_sections_names.length > 0 && (
                <NameCard title="Read every section" tone="ok" names={sm.all_sections_names} icon={CheckCircle2} />
              )}
              {sm.none_names.length > 0 && (
                <NameCard title="Yet to open any material" tone="warn" names={sm.none_names} icon={AlertTriangle} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, pct, icon: Icon, tone }) {
  const color = tone === 'warn' && value > 0 ? 'var(--color-warning-text)' : 'var(--color-text)';
  return (
    <div className="eg-card" style={{ padding: 14 }}>
      <div className="eg-lbl" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={11} /> {label}
      </div>
      <div style={{ fontSize: '1.7rem', fontWeight: 700, lineHeight: 1.2, marginTop: 3, color }}>{value}</div>
      {sub && <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)' }}>{sub}</div>}
      {pct != null && (
        <div className="eg-bar" style={{ marginTop: 7 }}><span style={{ width: `${pct}%` }} /></div>
      )}
    </div>
  );
}

function NameCard({ title, names, tone, icon: Icon }) {
  const fg = tone === 'warn' ? 'var(--color-warning-text)' : 'var(--color-success)';
  return (
    <div className="eg-card" style={{ padding: 16 }}>
      <div className="eg-lbl" style={{ marginBottom: 9, display: 'flex', alignItems: 'center', gap: 5, color: fg }}>
        <Icon size={11} /> {title} ({names.length})
      </div>
      {names.map(n => <span key={n} className="eg-name">{n}</span>)}
    </div>
  );
}

function Fact({ icon: Icon, title, value, link, linkLabel }) {
  return (
    <div style={{ display: 'flex', gap: 9 }}>
      <Icon size={14} style={{ color: 'var(--color-text-light)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '0.86rem', marginTop: 1, lineHeight: 1.4 }}>{value}</div>
        {link && (
          <a href={link} target="_blank" rel="noreferrer"
             style={{ fontSize: '0.74rem', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
            {linkLabel} <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

// Question-by-question survey results. Exported because the client portal shows
// these on a tab of their own as well as inside the engagement dashboard.
export function SurveyResults({ surveys, renderActions }) {
  if (!surveys || surveys.length === 0) return null;
  return (
    <div className="eg-card" style={{ padding: 16 }}>
      <style>{styles}</style>
      <h3 style={{ margin: '0 0 12px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 7 }}>
        <ClipboardList size={15} /> Survey responses
      </h3>
      {surveys.map(sv => (
        <div key={sv.id} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{sv.title}</div>
              <div style={{ ...muted, fontSize: '0.76rem' }}>
                {sv.phase === 'pre' ? 'Pre-meeting' : 'Post-meeting'} · {sv.response_count} response{sv.response_count === 1 ? '' : 's'} ({sv.response_pct}%)
              </div>
            </div>
            {/* Download / view live here so they sit beside the survey they act
                on, rather than as one toolbar above a list of several. */}
            {renderActions?.(sv)}
          </div>
          {sv.questions.length === 0 ? (
            <div style={{ ...muted, fontSize: '0.8rem' }}>This survey has no questions yet.</div>
          ) : sv.questions.map((q, qi) => (
            <div key={q.id} style={{ marginBottom: 12, paddingLeft: 10, borderLeft: '2px solid var(--color-border-light)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                <span style={{ color: 'var(--color-text-light)' }}>Q{q.number || qi + 1}.</span> {q.label}
              </div>
              <div style={{ ...muted, fontSize: '0.73rem', marginBottom: 5 }}>{q.answered_count} answered</div>
              {q.nps?.total > 0 && <NpsSummary nps={q.nps} />}
              {!q.nps && q.options.map(o => {
                const pct = q.answered_count ? Math.round(100 * o.count / q.answered_count) : 0;
                return (
                  <div key={o.label} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'flex', fontSize: '0.79rem', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                      <span style={{ fontWeight: 700 }}>{o.count}</span>
                      <span style={{ ...muted, width: 38, textAlign: 'right' }}>{pct}%</span>
                    </div>
                    <div className="eg-bar" style={{ height: 6, marginTop: 2 }}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {q.text_answers.map((t, i) => (
                <div key={i} style={{ fontSize: '0.81rem', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--color-border-light)' }}>
                  <strong>{t.expert_name}:</strong> {t.answer}
                </div>
              ))}
              {q.options.length === 0 && q.text_answers.length === 0 && (
                <div style={{ ...muted, fontSize: '0.78rem' }}>No answers yet.</div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
