import React, { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Briefcase, Users, BookOpen, DollarSign, Calendar, Settings } from 'lucide-react';
import { getMe } from '../services/api';
import OverviewTab        from './advisoryBoards/OverviewTab';
import BoardsTab          from './advisoryBoards/BoardsTab';
import MeetingsTab        from './advisoryBoards/MeetingsTab';
import MeetingDetail      from './advisoryBoards/MeetingDetail';
import KolsTab            from './advisoryBoards/KolsTab';
import ServicesCatalogTab from './advisoryBoards/ServicesCatalogTab';
import PricingTab         from './advisoryBoards/PricingTab';
import MabmAdminTab       from './advisoryBoards/MabmAdminTab';
import { useServiceCatalog } from './advisoryBoards/data';

const TABS = [
  { id: 'overview',   label: 'Overview',         icon: LayoutDashboard },
  { id: 'boards',     label: 'Advisory Boards',  icon: Briefcase },
  { id: 'meetings',   label: 'Meetings',         icon: Calendar },
  { id: 'kols',       label: 'KOLs',             icon: Users },
  { id: 'catalog',    label: 'Services Catalog', icon: BookOpen },
  { id: 'pricing',    label: 'Pricing',          icon: DollarSign, adminOnly: true },
  { id: 'mabm-admin', label: 'MABM Admin',       icon: Settings,   superAdminOnly: true },
];

export default function AdvisoryBoardsPage() {
  const [{ tab, meetingId, boardId, boardSection }, setRoute] = useState(() => readHash());
  const [role, setRole]                = useState(null);
  const [me, setMe]                    = useState(null);   // for organizer-only surfaces

  // Load service catalog from API once for the whole module. When it
  // populates, this hook triggers a re-render so child tabs see SERVICES.
  useServiceCatalog();

  useEffect(() => {
    getMe()
      .then(res => { setRole(res.data.role); setMe(res.data); })
      .catch(() => setRole('user'));
  }, []);

  // sync state ↔ url hash for deep links
  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goTab = (id) => {
    setRoute({ tab: id, meetingId: null, boardId: null, boardSection: null });
    if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`);
  };

  // A board detail is its own address: #boards/{id}. Pushed rather than
  // replaced so browser Back returns to the list, and so a detail view
  // survives a refresh or a pasted link. Idempotent — the child reports its
  // selection on mount too, and re-pushing the URL we are already on would
  // stack junk history entries.
  const syncBoard = useCallback((id) => {
    // Opening a board from the Overview tab has to move the tab too, or the
    // detail would be addressed but never rendered.
    setRoute((r) => (r.boardId === (id || null) && (!id || r.tab === 'boards')
      ? r
      : { tab: id ? 'boards' : r.tab, meetingId: null, boardId: id || null, boardSection: null }));
    const want = id ? `#boards/${id}` : '#boards';
    if (window.location.hash.split('/').slice(0, 2).join('/') !== want) {
      window.history.pushState(null, '', want);
    }
  }, []);

  // Moving between a board's sections is not a new page — replaceState, so Back
  // still leaves the board rather than walking every section you looked at.
  const syncBoardSection = useCallback((boardIdNow, section) => {
    if (!boardIdNow || !section) return;
    setRoute((r) => (r.boardSection === section ? r : { ...r, boardSection: section }));
    const want = `#boards/${boardIdNow}/${section}`;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  }, []);

  const openMeeting = (mId) => {
    setRoute({ tab: 'meetings', meetingId: mId, boardId: null, boardSection: null });
    window.history.replaceState(null, '', `#meetings/${mId}`);
  };

  const closeMeeting = () => {
    setRoute({ tab: 'meetings', meetingId: null, boardId: null, boardSection: null });
    window.history.replaceState(null, '', `#meetings`);
  };

  const isAdmin = role === 'super_admin' || role === 'admin';
  const isSuperAdmin = role === 'super_admin';
  const visibleTabs = TABS.filter(t => {
    if (t.superAdminOnly) return isSuperAdmin;
    if (t.adminOnly) return isAdmin;
    return true;
  });

  // if a non-admin lands on a gated tab via URL hash, fall back to overview
  useEffect(() => {
    if (role === null) return;
    const cur = TABS.find(t => t.id === tab);
    if (cur?.superAdminOnly && !isSuperAdmin) goTab('overview');
    else if (cur?.adminOnly && !isAdmin) goTab('overview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, tab]);

  return (
    <div className="page container">
      <div className="page-header">
        <h1 className="sr-only">Advisory Board</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Plan, run, and follow up on advisory board engagements — from KOL recruitment through post-meeting deliverables.
        </p>
      </div>

      {/* Tab nav */}
      <div style={{ borderBottom: '1px solid var(--color-border-light)', marginBottom: 22, display: 'flex', gap: 2, flexWrap: 'wrap', overflowX: 'auto' }}>
        {visibleTabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => goTab(t.id)} style={{
              padding: '10px 16px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
              color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1,
              whiteSpace: 'nowrap', transition: 'all var(--transition)',
            }}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab onOpenBoard={syncBoard} onTab={goTab} />}
      {tab === 'boards'   && <BoardsTab initialBoardId={boardId} onSelectionChange={syncBoard}
                                        initialSection={boardSection} onSectionChange={syncBoardSection}
                                        meId={me?.id} isPlatformAdmin={isAdmin} />}
      {tab === 'meetings' && (meetingId
        ? <MeetingDetail meetingId={meetingId} onBack={closeMeeting} />
        : <MeetingsTab onOpenMeeting={openMeeting} />)}
      {tab === 'kols'       && <KolsTab />}
      {tab === 'catalog'    && <ServicesCatalogTab />}
      {tab === 'pricing'    && isAdmin && <PricingTab canEdit={isAdmin} />}
      {tab === 'mabm-admin' && isSuperAdmin && <MabmAdminTab />}
    </div>
  );
}

// Hash format: #tab  OR  #meetings/{id}  OR  #boards/{id}[/{section}]
// The board's section (kols, documents, cost…) rides along so a refresh or a
// pasted link reopens the section you were on instead of dropping you on Overview.
function readHash() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  if (!raw) return { tab: 'overview', meetingId: null, boardId: null, boardSection: null };
  const [tabPart, idPart, sectionPart] = raw.split('/');
  const valid = TABS.map(t => t.id);
  const tab = valid.includes(tabPart) ? tabPart : 'overview';
  const id = idPart ? Number(idPart) || null : null;
  return {
    tab,
    meetingId: tab === 'meetings' ? id : null,
    boardId:   tab === 'boards'   ? id : null,
    boardSection: tab === 'boards' && id && sectionPart ? sectionPart : null,
  };
}
