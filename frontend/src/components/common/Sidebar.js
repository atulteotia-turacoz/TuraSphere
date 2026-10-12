import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Wordmark from './Wordmark';
import LogoMark from './LogoMark';
import {
  LayoutDashboard, ClipboardCheck, Settings,
  FileText, BarChart3, Landmark, X, BookOpen, MessageSquare, BookMarked,
  LifeBuoy,
} from 'lucide-react';

// Every module slug the nav knows about, grouped. Publications / Consensus /
// Recent Guidelines were missing entirely, so a user granted them saw nothing.
// `soon` marks a module that is entitled but not built — it still shows, and
// routes to a page that says so rather than 404ing.
const NAV_GROUPS = [
  {
    label: 'Engage',
    items: [
      { slug: 'advisory_boards', path: '/advisory-boards', label: 'Advisory Board', icon: Landmark },
      { slug: 'surveys', path: '/surveys', label: 'Surveys', icon: FileText },
      { slug: 'polling', path: '/polling', label: 'Polling', icon: BarChart3 },
    ],
  },
  {
    label: 'Insight',
    items: [
      // One entry, not two: "Assessment Forms" pointed at the SAME /assessments
      // path, and the forms live there as a tab (?tab=form-links). `altSlugs`
      // keeps the link reachable for an account granted only assessment_forms —
      // without it the nav filter would hide their only route to the page.
      { slug: 'assessments', altSlugs: ['assessment_forms'], path: '/assessments', label: 'KOL', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Disseminate',
    items: [
      { slug: 'publications', path: '/publications', label: 'Publications', icon: BookOpen, soon: true },
      { slug: 'consensus', path: '/consensus', label: 'Consensus', icon: MessageSquare, soon: true },
      // Nav label shortened — "Recent Guidelines" plus the badge cannot fit the
      // rail. The page itself still carries the full name.
      { slug: 'recent_guidelines', path: '/recent-guidelines', label: 'Guidelines', icon: BookMarked, soon: true },
    ],
  },
];

/**
 * Navigation rail. Presentational — the shell owns collapsed/drawer state, so
 * the app bar can drive the same values from the top of the page.
 */
export default function Sidebar({ collapsed, drawerOpen, onCloseDrawer, allowedServices }) {
  const location = useLocation();

  // Leaving the drawer open over the page you just moved to is disorienting.
  useEffect(() => { onCloseDrawer(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, onCloseDrawer]);

  const isActive = (path) => location.pathname.startsWith(path);
  // `allowedServices` is the EFFECTIVE set from the API (granted ∩ selected).
  // null still means unrestricted, for admins and legacy accounts.
  const showService = (item) => {
    if (allowedServices === null) return true;   // unrestricted: admins, legacy accounts
    const slugs = [item.slug, ...(item.altSlugs || [])];
    return slugs.some((s) => allowedServices.includes(s));
  };

  // Only render a group that has something in it — an empty "Disseminate"
  // heading is worse than no heading.
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(showService) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      {drawerOpen && (
        <div className="sidebar-scrim" onClick={onCloseDrawer} role="presentation" />
      )}

      <aside
        className={[
          'sidebar',
          collapsed ? 'is-collapsed' : '',
          drawerOpen ? 'is-open' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="sidebar-head">
          <Link to="/dashboard" className="sidebar-brand" title="TuraSphere KOL">
            {/* The sphere shows ONLY when the rail is collapsed, where the
                wordmark is hidden — otherwise it would repeat the sphere that
                is already inside the logo. */}
            <LogoMark className="sidebar-brand-mark" size={26} />
            <span className="sidebar-label"><Wordmark /></span>
          </Link>
          <button
            type="button"
            className="sidebar-close"
            onClick={onCloseDrawer}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <Link
            to="/dashboard"
            className={`sidebar-link${isActive('/dashboard') ? ' active' : ''}`}
            title={collapsed ? 'Dashboard' : undefined}
          >
            <LayoutDashboard size={18} />
            <span className="sidebar-label">Dashboard</span>
          </Link>

          {groups.map((group) => (
            <React.Fragment key={group.label}>
              <div className="sidebar-group-label">
                <span className="sidebar-label">{group.label}</span>
              </div>
              {group.items.map(({ slug, path, label, icon: Icon, soon }) => (
                <Link
                  key={slug}
                  to={path}
                  className={`sidebar-link${isActive(path) ? ' active' : ''}`}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={18} />
                  <span className="sidebar-label">{label}</span>
                  {soon && <span className="sidebar-soon sidebar-label">soon</span>}
                </Link>
              ))}
            </React.Fragment>
          ))}

          <div className="sidebar-group-label">
            <span className="sidebar-label">Account</span>
          </div>
          <Link
            to="/account"
            className={`sidebar-link${isActive('/account') ? ' active' : ''}`}
            title={collapsed ? 'My Account' : undefined}
          >
            <Settings size={18} />
            <span className="sidebar-label">My Account</span>
          </Link>
        </nav>

        {/* The rail read as mostly empty space below the nav. A support link
            gives the bottom something to sit on without inventing features. */}
        <div className="sidebar-foot">
          <a
            className="sidebar-link sidebar-help"
            href="mailto:support@turacoz.com"
            title={collapsed ? 'Help & support' : undefined}
          >
            <LifeBuoy size={18} />
            <span className="sidebar-label">Help &amp; Support</span>
          </a>
        </div>
      </aside>
    </>
  );
}
