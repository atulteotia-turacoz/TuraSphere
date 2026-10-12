import React, { useState, useEffect } from 'react';
import {
  Briefcase, Calendar, Users, Receipt, Clock, Video, MapPin, AlertTriangle,
  Check, ArrowRight, ClipboardList, PlayCircle, CheckCircle2, Landmark,
  BookOpen, MessageSquare, BookMarked, FileText, BarChart3, ListChecks, ClipboardCheck,
  CalendarCheck, Award, UserSearch,
} from 'lucide-react';
import {
  listAllMeetings, listPendingPreMeetingSurveys, getAccountConfigStatus,
  getMe, updateProfile, listSurveys, listPolls, listAssessments, listHCPs,
  getAssessmentStats,
} from '../services/api';
import {
  listBoards, listKols, PHASES, estimateBoardCost, formatMoney,
} from './advisoryBoards/data';

const disseminationItems = [
  { label: 'Advisory Boards', slug: 'advisory_boards', icon: <Landmark size={16} /> },
  { label: 'Publications', slug: 'publications', icon: <BookOpen size={16} /> },
  { label: 'Consensus', slug: 'consensus', icon: <MessageSquare size={16} /> },
  { label: 'Recent Guidelines', slug: 'recent_guidelines', icon: <BookMarked size={16} /> },
  { label: 'Surveys', slug: 'surveys', icon: <FileText size={16} /> },
  { label: 'Polling', slug: 'polling', icon: <BarChart3 size={16} /> },
  { label: 'KOL', slug: 'assessments', icon: <ClipboardCheck size={16} /> },
  // A tab inside KOL, not a nav module — but it is its own grant, and without a
  // toggle here an account whose selection lost it had no way to switch it back on.
  { label: 'Find KOLs', slug: 'find_kols', icon: <UserSearch size={16} /> },
  { label: 'Assessment Forms', slug: 'assessment_forms', icon: <ListChecks size={16} /> },
];

const M_STATUS = {
  scheduled: { label: 'Scheduled', color: 'var(--color-info)' },
  live:      { label: 'Live',      color: 'var(--color-success)' },
  completed: { label: 'Completed', color: 'var(--color-text-secondary)' },
  cancelled: { label: 'Cancelled', color: 'var(--color-error)' },
};

function relTime(date) {
  const mins = Math.round((date.getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

export default function DashboardPage() {
  const [boards, setBoards] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [kolCount, setKolCount] = useState(0);
  const [pendingSurveys, setPendingSurveys] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [polls, setPolls] = useState([]);
  const [assessCount, setAssessCount] = useState(0);
  const [recentAssessments, setRecentAssessments] = useState([]);
  const [assessStats, setAssessStats] = useState(null);
  const [hcpCount, setHcpCount] = useState(0);
  const [configMissing, setConfigMissing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkedItems, setCheckedItems] = useState(new Set());
  // null = we do not know (the /me call failed). An array is the answer from
  // the API, which always sends one — `granted_for()` resolves "unrestricted"
  // server-side, so a missing list here never means "everything".
  const [granted, setGranted] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Each source is independent — a failure in one shouldn't blank the dashboard.
      const [b, m, pSurveys, cfg, me, sv, pl, asmt, hcp, aStats] = await Promise.all([
        listBoards().catch(() => []),
        listAllMeetings({}).then(r => r.data || []).catch(() => []),
        listPendingPreMeetingSurveys().then(r => r.data || []).catch(() => []),
        getAccountConfigStatus().then(r => r.data || {}).catch(() => ({})),
        getMe().then(r => r.data).catch(() => null),
        listSurveys().then(r => r.data || []).catch(() => []),
        listPolls().then(r => r.data || []).catch(() => []),
        listAssessments({ limit: 5 }).then(r => r.data).catch(() => null),
        listHCPs({ limit: 1 }).then(r => r.data).catch(() => null),
        getAssessmentStats().then(r => r.data).catch(() => null),
      ]);
      if (cancelled) return;
      setBoards(b);
      setMeetings(m);
      setKolCount(listKols().length);
      setPendingSurveys(pSurveys);
      setSurveys(Array.isArray(sv) ? sv : (sv?.items || []));
      setPolls(Array.isArray(pl) ? pl : (pl?.items || []));
      setAssessCount(asmt?.total ?? (Array.isArray(asmt) ? asmt.length : (asmt?.items?.length || 0)));
      setRecentAssessments(Array.isArray(asmt?.items) ? asmt.items : (Array.isArray(asmt) ? asmt : []));
      setAssessStats(aStats);
      setHcpCount(hcp?.total ?? (Array.isArray(hcp) ? hcp.length : (hcp?.items?.length || 0)));

      const missing = [];
      if (cfg.smtp?.source !== 'account') missing.push({ label: 'Email (SMTP)', tab: 'email-smtp' });
      if (cfg.zoom?.source !== 'account' && cfg.teams?.source !== 'account') {
        missing.push({ label: 'Meeting platform (Zoom/Teams)', tab: 'meeting-platforms' });
      }
      // 'platform' means they're falling back to the platform's X account, not their own.
      if (cfg.twitter?.source !== 'account') {
        missing.push({ label: 'X (Twitter) integration', tab: 'twitter' });
      }
      // Without their own key an account runs on the platform (admin) key — it
      // still works, so the note says so rather than reading as broken.
      const fallbackNote = (src) => (src === 'platform' ? 'using the platform key for now' : 'using the free fallback for now');
      if (cfg.google_search?.source !== 'account') {
        missing.push({ label: 'Google Search (SerpAPI)', tab: 'google-search', note: fallbackNote(cfg.google_search?.source) });
      }
      if (cfg.google_scholar?.source !== 'account') {
        missing.push({ label: 'Google Scholar', tab: 'google-scholar', note: fallbackNote(cfg.google_scholar?.source) });
      }
      setConfigMissing(missing);

      // Two different sets now: what an admin GRANTED (what the toolkit may
      // offer at all) and what the user has switched on within that.
      try {
        // `me === null` means the request failed and we know nothing. Anything
        // else is an answer — and an answer without a list is an empty grant,
        // not a free pass, since /auth/me always populates the field.
        setGranted(me ? (Array.isArray(me.granted_service_list) ? me.granted_service_list : []) : null);

        const effective = Array.isArray(me?.effective_services) ? me.effective_services : null;
        if (effective) {
          setCheckedItems(new Set(effective));
        } else {
          const svc = me?.allowed_services
            ? (typeof me.allowed_services === 'string' ? JSON.parse(me.allowed_services) : me.allowed_services)
            : null;
          if (Array.isArray(svc)) setCheckedItems(new Set(svc));
        }
      } catch { /* ignore bad json */ }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // The toolkit is a switch over what you HAVE, not a way to grant yourself
  // more — the API clamps writes to the grant anyway, so offering an ungranted
  // module here would just be a checkbox that silently does nothing.
  // `granted` gates what exists on the account; `checkedItems` gates what the
  // user has switched on. A tile needs both, which is exactly the effective set.
  // Fails closed. This used to read `granted === null || ...`, so a failed
  // /me call — the one case where entitlements are unknown — unlocked every
  // module on the dashboard and offered all eight in the toolkit.
  const hasModule = (slug) =>
    Array.isArray(granted) && granted.includes(slug) && checkedItems.has(slug);

  const hasBoards = hasModule('advisory_boards');

  const visibleDisseminationItems = Array.isArray(granted)
    ? disseminationItems.filter((i) => granted.includes(i.slug))
    : [];

  const toggleCheck = (slug) => setCheckedItems(prev => {
    const s = new Set(prev); if (s.has(slug)) s.delete(slug); else s.add(slug); return s;
  });
  const handleApply = async () => {
    setSaving(true);
    try { await updateProfile({ allowed_services: [...checkedItems] }); window.location.reload(); }
    catch { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-container"><div className="spinner" /><p>Loading dashboard…</p></div>
      </div>
    );
  }

  // ── Derived metrics ──
  const totalBoards = boards.length;
  const inPipeline = boards.filter(b => !['completed', 'cancelled'].includes(b.status)).length;
  const completed = boards.filter(b => b.status === 'completed').length;
  const pipelineValue = boards
    .filter(b => b.status !== 'cancelled')
    .reduce((s, b) => s + (estimateBoardCost(b).total || 0), 0);

  const liveMeetings = meetings.filter(m => m.status === 'live');
  const upcoming = meetings
    .filter(m => (m.status === 'scheduled' || m.status === 'live') && m.scheduled_at)
    .sort((a, c) => {
      if ((a.status === 'live') !== (c.status === 'live')) return a.status === 'live' ? -1 : 1;
      return new Date(a.scheduled_at) - new Date(c.scheduled_at);
    });
  const upcomingFuture = upcoming.filter(m => m.status === 'live' || new Date(m.scheduled_at) >= new Date(Date.now() - 3600_000));

  const phaseCounts = PHASES.map(p => ({ ...p, count: boards.filter(b => b.currentPhase === p.id).length }));
  const maxPhase = Math.max(1, ...phaseCounts.map(p => p.count));

  const isActive = (x) => (x.status || '').toLowerCase() === 'active';
  const isDraft = (x) => (x.status || '').toLowerCase() === 'draft';
  const activeSurveys = surveys.filter(isActive).length;
  const activePolls = polls.filter(isActive).length;

  // Everything below comes from data the dashboard was ALREADY fetching and
  // then throwing away after taking a length.
  const surveyResponses = surveys.reduce((n, x) => n + (x.response_count || 0), 0);
  const pollVotes = polls.reduce((n, x) => n + (x.vote_count || x.total_votes || 0), 0);

  const now = new Date();
  const thisMonth = (d) => {
    if (!d) return false;
    const t = new Date(d);
    return t.getMonth() === now.getMonth() && t.getFullYear() === now.getFullYear();
  };
  const meetingsThisMonth = meetings.filter(m => thisMonth(m.scheduled_at)).length;
  const completedMeetings = meetings.filter(m => m.status === 'completed').length;

  // Most-answered survey / poll — "you have 6 surveys" says far less than which
  // one people are actually filling in.
  const topEngagement = [
    ...(hasModule('surveys') ? surveys.map(x => ({ id: `s${x.id}`, kind: 'Survey', title: x.title, count: x.response_count || 0, href: '/surveys' })) : []),
    ...(hasModule('polling') ? polls.map(x => ({ id: `p${x.id}`, kind: 'Poll', title: x.title, count: x.vote_count || x.total_votes || 0, href: '/polling' })) : []),
  ].filter(x => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);

  // Boards with nothing on the calendar — the most actionable thing an
  // engagement lead can see at a glance.
  const boardIdsWithMeetings = new Set(meetings.map(m => m.board_id).filter(Boolean));
  const boardsNoMeeting = boards.filter(
    b => b.status !== 'completed' && b.status !== 'cancelled' && !boardIdsWithMeetings.has(b.id)
  ).slice(0, 5);

  // Tier mix, ordered high → low so the bars read as a ladder rather than
  // whatever order the database happened to group by.
  const TIER_ORDER = ['GLOBAL_KOL', 'STRATEGIC_KOL', 'NATIONAL_KOL', 'EMERGING_KOL', 'LOCAL_KOL', 'NON_KOL'];
  const tierCounts = assessStats?.tier_counts || {};
  const tierRows = TIER_ORDER
    .filter(t => tierCounts[t])
    .map(t => ({ tier: t, label: t.replace(/_/g, ' '), count: tierCounts[t] }));
  // Anything the backend returns that is not in TIER_ORDER still gets shown —
  // a new tier should not silently vanish from the chart.
  Object.keys(tierCounts)
    .filter(t => !TIER_ORDER.includes(t))
    .forEach(t => tierRows.push({ tier: t, label: t.replace(/_/g, ' '), count: tierCounts[t] }));
  const tierMax = Math.max(1, ...tierRows.map(r => r.count));

  const quickActions = [
    hasModule('assessments') && { key: 'assess', label: 'New Assessment', icon: <ClipboardCheck size={15} />, href: '/hcp/new' },
    hasModule('advisory_boards') && { key: 'board', label: 'New Advisory Board', icon: <Landmark size={15} />, href: '/advisory-boards#boards' },
    hasModule('surveys') && { key: 'survey', label: 'Create Survey', icon: <FileText size={15} />, href: '/surveys' },
    hasModule('polling') && { key: 'poll', label: 'Create Poll', icon: <BarChart3 size={15} />, href: '/polling' },
  ].filter(Boolean);

  const engagementTiles = [
    hasModule('surveys') && <Stat key="surveys" icon={<FileText />} tone="info" label="Surveys" value={surveys.length} sub={`${activeSurveys} active · ${surveyResponses} responses`} href="/surveys" />,
    hasModule('polling') && <Stat key="polls" icon={<BarChart3 />} tone="pink" label="Polls" value={polls.length} sub={`${activePolls} active · ${pollVotes} votes`} href="/polling" />,
    hasModule('assessments') && <Stat key="kol" icon={<ClipboardCheck />} tone="success" label="KOL Assessments" value={assessCount} href="/assessments" />,
    hasModule('assessments') && <Stat key="hcp" icon={<Landmark />} tone="primary" label="HCP Profiles" value={hcpCount} href="/assessments" />,
  ].filter(Boolean);

  // Detailed, actionable "pending" list: surveys you must fill before a meeting +
  // your own draft surveys/polls that haven't been sent/launched yet.
  const pendingItems = [
    ...pendingSurveys.map(p => ({
      key: `psurvey-${p.link_id}`, icon: <ClipboardList size={15} />, color: 'var(--color-primary)',
      title: p.survey_title || 'Pre-meeting survey',
      meta: `Fill before "${p.meeting_title}"`,
      href: `/survey/${p.survey_token}`, cta: 'Fill',
    })),
    // Drafts are module content, so they follow the module. `pendingSurveys`
    // above deliberately does not: those are invitations to fill someone
    // else's survey over a public token link, not access to the Surveys
    // module, and gating them would break the participant flow.
    ...(hasModule('surveys') ? surveys.filter(isDraft).map(s => ({
      key: `dsurvey-${s.id}`, icon: <FileText size={15} />, color: 'var(--color-info)',
      title: s.title || 'Untitled survey',
      meta: 'Draft survey — not sent yet',
      href: `/surveys/${s.id}/edit`, cta: 'Open',
    })) : []),
    ...(hasModule('polling') ? polls.filter(isDraft).map(p => ({
      key: `dpoll-${p.id}`, icon: <BarChart3 size={15} />, color: 'var(--color-pink)',
      title: p.title || p.question || 'Untitled poll',
      meta: 'Draft poll — not launched yet',
      href: '/polling', cta: 'Open',
    })) : []),
  ];

  // ── Action items ──
  const actions = [];
  // A "join the live meeting" prompt linking into /advisory-boards is module
  // content like any other.
  if (hasBoards) {
    liveMeetings.forEach(m => actions.push({
      icon: <PlayCircle size={16} />, color: 'var(--color-success)',
      text: <><strong>{m.title}</strong> is live now</>, href: `/advisory-boards#meetings/${m.id}`, cta: 'Join',
    }));
  }
  configMissing.forEach(c => actions.push({
    icon: <AlertTriangle size={16} />, color: 'var(--color-warning)',
    text: <>Set up your <strong>{c.label}</strong>{c.note && <span style={{ color: 'var(--color-text-secondary)' }}> — {c.note}</span>}</>,
    href: `/account#${c.tab}`, cta: 'Configure',
  }));

  return (
    <div className="page container">
      <div className="page-header">
        <h1 className="sr-only">Dashboard</h1>
        <p>{hasBoards ? 'Your advisory board engagements at a glance' : 'Your workspace at a glance'}</p>
      </div>

      {/* Advisory board KPIs. Gated like every other module — board counts and
          pipeline value were showing to accounts with no advisory_boards
          grant, which is business data they are not entitled to. */}
      {hasBoards && (
        <>
          <h2 className="section-heading">Advisory Boards</h2>
          <div className="stat-grid">
            <Stat icon={<Briefcase />} tone="primary" label="Total Boards" value={totalBoards} sub={`${completed} completed`} />
            <Stat icon={<Clock />}     tone="warning" label="In Pipeline" value={inPipeline} sub="active engagements" />
            <Stat icon={<Calendar />}  tone="info" label="Upcoming Meetings" value={upcomingFuture.length} sub={liveMeetings.length ? `${liveMeetings.length} live now` : 'scheduled'} live={liveMeetings.length > 0} />
            <Stat icon={<CalendarCheck />} tone="success" label="Meetings This Month" value={meetingsThisMonth} sub={`${completedMeetings} completed all-time`} />
            <Stat icon={<Users />}     tone="success" label="KOLs in Directory" value={kolCount} />
            <Stat icon={<Receipt />}   tone="violet" label="Pipeline Value" value={pipelineValue > 0 ? formatMoney(pipelineValue, 'USD') : '—'} sub="est. across boards" />
          </div>
        </>
      )}

      {/* Engagement KPIs — only for modules this account actually has. Showing a
          Polls count to someone without the Polling module is noise at best and
          a wrong impression of what they can reach at worst. */}
      {engagementTiles.length > 0 && (
        <>
          <h2 className="section-heading">Engagement</h2>
          <div className="stat-grid">{engagementTiles}</div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* ── Main column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* Upcoming & live meetings */}
          {hasBoards && (
          <Panel title="Upcoming & Live Meetings" icon={<Calendar size={16} />} action={<a className="btn btn-sm btn-ghost" href="/advisory-boards#meetings">All meetings <ArrowRight size={12} /></a>}>
            {upcomingFuture.length === 0 ? (
              <Empty icon={<Calendar size={30} />} text="No upcoming meetings. Schedule one from an advisory board." />
            ) : (
              upcomingFuture.slice(0, 6).map(m => <MeetingRow key={m.id} m={m} />)
            )}
          </Panel>
          )}

          {/* Boards by phase */}
          {hasBoards && (
          <Panel title="Boards by Phase" icon={<CheckCircle2 size={16} />} action={<a className="btn btn-sm btn-ghost" href="/advisory-boards#boards">View boards <ArrowRight size={12} /></a>}>
            {totalBoards === 0 ? (
              <Empty icon={<Briefcase size={30} />} text="No advisory boards yet." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
                {phaseCounts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 110, fontSize: '0.82rem', color: 'var(--color-text-secondary)', flexShrink: 0 }}>{p.label}</div>
                    <div style={{ flex: 1, height: 10, background: 'var(--color-border-light, var(--color-surface-raised))', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${(p.count / maxPhase) * 100}%`, height: '100%', background: p.color, borderRadius: 999, transition: 'width .3s' }} />
                    </div>
                    <div style={{ width: 28, textAlign: 'right', fontSize: '0.85rem', fontWeight: 700 }}>{p.count}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          )}

          {/* Recent assessments — the count tile said "12 assessments" and nothing
              about who or how they scored. */}
          {hasModule('assessments') && (
            <Panel
              title="Recent Assessments"
              icon={<ClipboardCheck size={16} />}
              action={<a className="btn btn-sm btn-ghost" href="/assessments">All assessments <ArrowRight size={12} /></a>}
            >
              {recentAssessments.length === 0 ? (
                <Empty icon={<ClipboardCheck size={30} />} text="No assessments yet. Score your first HCP to see them here." />
              ) : (
                <div className="dash-list">
                  {recentAssessments.map(a => (
                    <a key={a.id} href={`/hcp/${a.hcp_id}/results`} className="dash-row">
                      <span className="dash-row-main">
                        <span className="dash-row-title">{a.hcp_name || 'Unnamed HCP'}</span>
                        <span className="dash-row-meta">
                          {[a.specialty, a.created_at ? new Date(a.created_at).toLocaleDateString() : null]
                            .filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {a.tier && <span className="dash-tier">{String(a.tier).replace(/_/g, ' ')}</span>}
                      <span className="dash-row-value">
                        {a.final_score != null ? Number(a.final_score).toFixed(1) : '--'}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {/* What people are actually answering. */}
          {(hasModule('surveys') || hasModule('polling')) && topEngagement.length > 0 && (
            <Panel title="Most Answered" icon={<BarChart3 size={16} />}>
              <div className="dash-list">
                {topEngagement.map(x => (
                  <a key={x.id} href={x.href} className="dash-row">
                    <span className="dash-row-main">
                      <span className="dash-row-title">{x.title || 'Untitled'}</span>
                      <span className="dash-row-meta">{x.kind}</span>
                    </span>
                    <span className="dash-row-value">
                      {x.count}
                      <span className="dash-row-unit">{x.kind === 'Poll' ? 'votes' : 'responses'}</span>
                    </span>
                  </a>
                ))}
              </div>
            </Panel>
          )}

          {/* Boards with nothing on the calendar — the most actionable item here. */}
          {hasModule('advisory_boards') && boardsNoMeeting.length > 0 && (
            <Panel
              title="Boards Without a Scheduled Meeting"
              icon={<AlertTriangle size={16} />}
              badge={boardsNoMeeting.length}
            >
              <div className="dash-list">
                {boardsNoMeeting.map(b => (
                  <a key={b.id} href="/advisory-boards#boards" className="dash-row">
                    <span className="dash-row-main">
                      <span className="dash-row-title">{b.title || 'Untitled board'}</span>
                      <span className="dash-row-meta">
                        {[b.client, b.current_phase ? String(b.current_phase).replace(/_/g, ' ') : null]
                          .filter(Boolean).join(' · ') || 'No client set'}
                      </span>
                    </span>
                    <span className="dash-row-cta">Schedule →</span>
                  </a>
                ))}
              </div>
            </Panel>
          )}

          {/* Pending items (surveys to fill + draft surveys/polls) */}
          <Panel title="Pending Surveys & Polls" icon={<ClipboardList size={16} />} badge={pendingItems.length || null}>
            {pendingItems.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 4px', color: 'var(--color-success)', fontSize: '0.86rem' }}>
                <CheckCircle2 size={16} /> Nothing pending — no surveys to fill and no drafts.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {pendingItems.map((it, i) => (
                  <a key={it.key} href={it.href} style={{
                    display: 'flex', alignItems: 'center', gap: 11, padding: '11px 2px',
                    borderBottom: i < pendingItems.length - 1 ? '1px solid var(--color-border-light)' : 'none',
                    textDecoration: 'none', color: 'inherit',
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: `${it.color}1A`, color: it.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {it.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.meta}</div>
                    </div>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: it.color, whiteSpace: 'nowrap' }}>{it.cta} →</span>
                  </a>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ── Sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* Quick actions — the right rail ran out of content well before the
              main column did. These are the four things people come here to
              start, and each is gated on the module. */}
          {quickActions.length > 0 && (
            <Panel title="Quick Actions" icon={<PlayCircle size={16} />}>
              <div className="quick-actions">
                {quickActions.map(a => (
                  <a key={a.key} href={a.href} className="quick-action">
                    <span className="quick-action-icon">{a.icon}</span>
                    <span>{a.label}</span>
                    <ArrowRight size={13} className="quick-action-arrow" />
                  </a>
                ))}
              </div>
            </Panel>
          )}

          {/* Tier mix — aggregated server-side, so this is the whole book rather
              than whatever happened to be in the last page of results. */}
          {hasModule('assessments') && assessStats && assessStats.total > 0 && (
            <Panel
              title="KOL Tier Mix"
              icon={<Award size={16} />}
              action={<span className="panel-note">avg {assessStats.avg_score}</span>}
            >
              <div className="rank-list">
                {tierRows.map(r => (
                  <div className="rank-row" key={r.tier}>
                    <span className="rank-label">{r.label}</span>
                    <span className="rank-track">
                      <span className="rank-fill" style={{ width: `${Math.round((r.count / tierMax) * 100)}%` }} />
                    </span>
                    <span className="rank-count">{r.count}</span>
                  </div>
                ))}
              </div>
              {assessStats.top_specialties?.length > 0 && (
                <>
                  <div className="panel-subhead">Top specialties</div>
                  <div className="chip-row">
                    {assessStats.top_specialties.map(sp => (
                      <span className="chip" key={sp.specialty}>
                        {sp.specialty}<span className="chip-count">{sp.count}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          )}

          {/* Needs attention */}
          <Panel title="Needs Attention" icon={<AlertTriangle size={16} />} badge={actions.length || null}>
            {actions.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 4px', color: 'var(--color-success)', fontSize: '0.86rem' }}>
                <CheckCircle2 size={16} /> You're all caught up.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {actions.map((a, i) => (
                  <a key={i} href={a.href} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px',
                    borderBottom: i < actions.length - 1 ? '1px solid var(--color-border-light)' : 'none',
                    textDecoration: 'none', color: 'inherit',
                  }}>
                    <span style={{ color: a.color, flexShrink: 0, display: 'flex' }}>{a.icon}</span>
                    <span style={{ flex: 1, fontSize: '0.83rem', minWidth: 0 }}>{a.text}</span>
                    <span style={{ fontSize: '0.74rem', fontWeight: 600, color: a.color, whiteSpace: 'nowrap' }}>{a.cta} →</span>
                  </a>
                ))}
              </div>
            )}
          </Panel>

          {/* Dissemination Toolkit (kept) */}
          <Panel title="Dissemination Toolkit" icon={<ListChecks size={16} />}>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
              Select the tools for your workflow.
            </p>
            {visibleDisseminationItems.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', margin: '10px 0' }}>
                {granted === null
                  ? 'Couldn\u2019t load your permissions. Reload the page — nothing is offered until we know what your account is entitled to.'
                  : 'No modules have been assigned to your account yet. Contact your administrator to have them enabled.'}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visibleDisseminationItems.map((item) => {
                const on = checkedItems.has(item.slug);
                return (
                  <div key={item.slug} onClick={() => toggleCheck(item.slug)} style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    border: `1.5px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: on ? 'var(--color-primary-bg, var(--color-primary-bg))' : 'var(--color-bg)',
                    display: 'flex', alignItems: 'center', gap: 9,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      border: `2px solid ${on ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                      background: on ? 'var(--color-primary)' : 'var(--color-surface)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{on && <Check size={11} style={{ color: 'var(--color-text-inverse)' }} />}</div>
                    <span style={{ color: on ? 'var(--color-primary)' : 'var(--color-text-secondary)', display: 'flex' }}>{item.icon}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: on ? 'var(--color-primary)' : 'var(--color-text)' }}>{item.label}</span>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 12, fontSize: '0.85rem' }} onClick={handleApply} disabled={saving || visibleDisseminationItems.length === 0}>
              {saving ? 'Applying…' : 'Apply'}
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ── Small building blocks ──

/**
 * Dashboard KPI tile. Uses the shared `.stat-card` styles so every module's
 * dashboard reads identically — `tone` picks the icon chip's tint.
 */
function Stat({ icon, tone = 'primary', label, value, sub, live, href }) {
  const inner = (
    <>
      <div className="stat-label">{label}</div>
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className={`stat-sub${live ? ' is-live' : ''}`}>{sub}</div>}
    </>
  );
  return href
    ? <a href={href} className="stat-card">{inner}</a>
    : <div className="stat-card">{inner}</div>;
}

function Panel({ title, icon, action, badge, children }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon} {title}
          {badge ? <span style={{ background: 'var(--color-error)', color: 'var(--color-text-inverse)', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px' }}>{badge}</span> : null}
        </h4>
        {action}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function MeetingRow({ m }) {
  const s = M_STATUS[m.status] || M_STATUS.scheduled;
  const when = m.scheduled_at ? new Date(m.scheduled_at) : null;
  const FmtIcon = m.format === 'in_person' ? MapPin : Video;
  const soon = m.status === 'scheduled' && when && (when.getTime() - Date.now()) <= 3600_000 && when.getTime() >= Date.now();
  return (
    <a href={`/advisory-boards#meetings/${m.id}`} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px',
      borderBottom: '1px solid var(--color-border-light)', textDecoration: 'none', color: 'inherit',
    }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: `${s.color}1A`, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <FmtIcon size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Briefcase size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />{m.board_title || 'Board'}
          {when && <> · <Clock size={10} style={{ verticalAlign: 'middle', marginRight: 2 }} />{when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
        </div>
      </div>
      {m.status === 'live'
        ? <span style={badgeStyle('var(--color-success)')}><PlayCircle size={11} /> Live</span>
        : soon
          ? <span style={badgeStyle('var(--color-warning)')}>{relTime(when)}</span>
          : <span style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap' }}>{when ? relTime(when) : ''}</span>}
      <ArrowRight size={14} style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />
    </a>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
      <div style={{ color: 'var(--color-text-light)', marginBottom: 8, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <div style={{ fontSize: '0.88rem' }}>{text}</div>
    </div>
  );
}

const badgeStyle = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999,
  fontSize: '0.7rem', fontWeight: 700, background: `${color}1A`, color, whiteSpace: 'nowrap',
});
