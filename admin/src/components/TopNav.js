import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import Wordmark from './Wordmark';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  ClipboardCheck,
  FileText,
  LogOut,
  ChevronDown,
  Shield,
  Menu,
  X,
  Brain,
  CreditCard,
  Package,
  Settings,
  Database,
  Wrench,
  FlaskConical,
  BookOpen,
  Linkedin,
  Twitter,
  Stethoscope,
  Globe,
  Layers,
  Briefcase,
  Video,
  Mail,
} from 'lucide-react';

const mainNavItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/audit-logs', label: 'Audit Logs', icon: FileText },
];

const configItems = [
  { path: '/ai-config', label: 'AI Config', icon: Brain },
  { path: '/pubmed-config', label: 'PubMed / NCBI', icon: Database },
  { path: '/clinical-trials-config', label: 'ClinicalTrials.gov', icon: FlaskConical },
  { path: '/google-scholar-config', label: 'Google Scholar', icon: BookOpen },
  { path: '/linkedin-config', label: 'LinkedIn', icon: Linkedin },
  { path: '/twitter-config', label: 'X (Twitter)', icon: Twitter },
  { path: '/practo-config', label: 'Practo', icon: Stethoscope },
  { path: '/web-search-config', label: 'Google Search', icon: Globe },
  { path: '/payment-gateways', label: 'Payment Gateway', icon: CreditCard },
  { path: '/plans', label: 'Plans', icon: Package },
  { path: '/parameters', label: 'Parameters', icon: Settings },
  { path: '/master-data', label: 'Master Data', icon: Layers },
  { path: '/advisory-services', label: 'Advisory Board Services', icon: Briefcase },
  { path: '/meeting-integrations', label: 'Teams & Zoom', icon: Video },
  { path: '/smtp-email', label: 'SMTP / Email', icon: Mail },
  { path: '/email-logs', label: 'Email Logs', icon: FileText },
];

// All items flat for mobile menu
const allNavItems = [...mainNavItems, ...configItems];

export default function TopNav() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const profileRef = useRef(null);
  const configRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('admin_user') || '{}');

  const isConfigActive = configItems.some((item) => location.pathname.startsWith(item.path));

  useEffect(() => {
    const handleClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
      if (configRef.current && !configRef.current.contains(e.target)) {
        setConfigOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    navigate('/login');
  };

  const initials = (user.full_name || 'A')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="topnav">
      <div className="topnav-inner">
        {/* Brand */}
        <div className="topnav-brand">

          <div className="topnav-brand-text">
            <span className="topnav-brand-name"><Wordmark /></span>
            <span className="topnav-brand-tag">Admin</span>
          </div>
        </div>

        {/* Desktop Nav */}
        <nav className="topnav-links">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `topnav-link ${isActive ? 'active' : ''}`
                }
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          {/* Configuration Dropdown */}
          <div className="topnav-config-dropdown" ref={configRef} style={{ position: 'relative' }}>
            <button
              className={`topnav-link ${isConfigActive ? 'active' : ''}`}
              onClick={() => setConfigOpen((o) => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <Wrench size={16} />
              <span>Configuration</span>
              <ChevronDown
                size={12}
                style={{
                  marginLeft: 2,
                  transition: 'transform 0.2s',
                  transform: configOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </button>

            {configOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: 'var(--content-card-bg)',
                  borderRadius: 8,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
                  border: '1px solid var(--border-color)',
                  minWidth: 220,
                  zIndex: 1000,
                  padding: '6px 0',
                }}
              >
                {configItems.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname.startsWith(item.path);
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setConfigOpen(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 16px',
                        fontSize: '0.88rem',
                        color: active ? 'var(--primary)' : 'var(--text-secondary)',
                        background: active ? 'var(--primary-light)' : 'transparent',
                        textDecoration: 'none',
                        fontWeight: active ? 600 : 400,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--content-bg)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Icon size={16} style={{ color: active ? 'var(--primary)' : 'var(--text-secondary)' }} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Right section */}
        <div className="topnav-right">
          <ThemeToggle />
          {/* Profile dropdown */}
          <div className="topnav-profile" ref={profileRef}>
            <button
              className="topnav-profile-btn"
              onClick={() => setProfileOpen((o) => !o)}
            >
              <div className="topnav-avatar">{initials}</div>
              <div className="topnav-profile-info">
                <span className="topnav-profile-name">{user.full_name || 'Admin'}</span>
                <span className="topnav-profile-role">
                  {(user.role || 'admin').replace('_', ' ')}
                </span>
              </div>
              <ChevronDown
                size={14}
                className={`topnav-chevron ${profileOpen ? 'open' : ''}`}
              />
            </button>

            {profileOpen && (
              <div className="topnav-dropdown">
                <div className="topnav-dropdown-header">
                  <div className="topnav-avatar lg">{initials}</div>
                  <div>
                    <div className="dropdown-name">{user.full_name}</div>
                    <div className="dropdown-email">{user.email}</div>
                  </div>
                </div>
                <div className="topnav-dropdown-divider" />
                <button className="topnav-dropdown-item" onClick={() => { setProfileOpen(false); navigate('/dashboard'); }}>
                  <LayoutDashboard size={15} />
                  Dashboard
                </button>
                <button className="topnav-dropdown-item" onClick={() => { setProfileOpen(false); navigate('/users'); }}>
                  <Shield size={15} />
                  Manage Users
                </button>
                <div className="topnav-dropdown-divider" />
                <button className="topnav-dropdown-item danger" onClick={handleLogout}>
                  <LogOut size={15} />
                  Sign Out
                </button>
              </div>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            className="topnav-mobile-toggle"
            onClick={() => setMobileMenuOpen((o) => !o)}
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="topnav-mobile-menu">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `topnav-mobile-link ${isActive ? 'active' : ''}`
                }
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          <div className="topnav-dropdown-divider" />
          <div style={{ padding: '6px 16px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Configuration
          </div>
          {configItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `topnav-mobile-link ${isActive ? 'active' : ''}`
                }
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          <div className="topnav-dropdown-divider" />
          <button className="topnav-mobile-link danger" onClick={handleLogout}>
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </header>
  );
}
