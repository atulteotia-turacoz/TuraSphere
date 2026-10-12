import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Wordmark from './Wordmark';
import LogoMark from './LogoMark';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  ClipboardCheck,
  FileText,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Shield,
  Settings,
  Database,
  Briefcase,
} from 'lucide-react';

const menuSections = [
  {
    label: 'Overview',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Management',
    items: [
      { path: '/users', label: 'Users', icon: Users },
      { path: '/hcps', label: 'HCP Profiles', icon: UserCheck },
      { path: '/assessments', label: 'Assessments', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { path: '/parameters', label: 'Assessment Parameters', icon: Settings },
      { path: '/advisory-services', label: 'Advisory Board Services', icon: Briefcase },
      { path: '/pubmed-config', label: 'PubMed / NCBI API', icon: Database },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/audit-logs', label: 'Audit Logs', icon: FileText },
    ],
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('admin_user') || '{}');

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/login';
  };

  const sidebarClass = [
    'sidebar',
    collapsed ? 'collapsed' : '',
    mobileOpen ? 'mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={sidebarClass}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            {/* Sphere only while collapsed — see the frontend sidebar. */}
            <LogoMark className="sidebar-brand-mark" size={26} />
            <div className="logo-text">
              <span className="logo-title"><Wordmark /></span>
              <span className="logo-subtitle">Admin</span>
            </div>
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {menuSections.map((section) => (
            <div key={section.label} className="nav-section">
              <div className="nav-section-label">{section.label}</div>
              <ul className="nav-menu">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path ||
                    (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        className={`nav-link ${isActive ? 'active' : ''}`}
                        title={item.label}
                      >
                        <span className="nav-link-icon">
                          <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                        </span>
                        <span className="nav-link-text">{item.label}</span>
                        {isActive && <span className="nav-active-indicator" />}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User Card & Footer */}
        <div className="sidebar-bottom">
          <div className="sidebar-user-card">
            <div className="user-avatar-sm">
              <Shield size={14} />
            </div>
            <div className="user-card-info">
              <span className="user-card-name">{user.full_name || 'Admin'}</span>
              <span className="user-card-role">{(user.role || 'admin').replace('_', ' ')}</span>
            </div>
            <button className="user-logout-btn" onClick={handleLogout} title="Logout">
              <LogOut size={15} />
            </button>
          </div>
          <div className="sidebar-version">
            <span>v1.0.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}

export function useMobileSidebar() {
  const toggle = () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('mobile-open');
    }
  };
  return toggle;
}
