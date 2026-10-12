import React from 'react';
import { PanelLeftClose, PanelLeftOpen, Menu, LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Breadcrumbs from './Breadcrumbs';
import ThemeToggle from './ThemeToggle';

/**
 * Top bar of the main column.
 *
 * Carries the breadcrumb trail and the sidebar control. The collapse toggle
 * lives here rather than at the bottom of the sidebar: it acts on the sidebar,
 * so it belongs where the eye already is when scanning where you are.
 */
export default function AppBar({ collapsed, onToggleCollapse, onOpenDrawer, userName }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <header className="appbar">
      {/* Desktop: collapse the rail. Mobile: open the drawer. Same slot. */}
      <button
        type="button"
        className="appbar-icon-btn appbar-collapse"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <button
        type="button"
        className="appbar-icon-btn appbar-drawer"
        onClick={onOpenDrawer}
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      <Breadcrumbs />

      <div className="appbar-actions">
        <ThemeToggle />
        {userName && (
          <span className="appbar-user" title={userName}>
            <User size={14} />
            <span className="appbar-username">{userName}</span>
          </span>
        )}
        <button
          type="button"
          className="appbar-icon-btn appbar-logout"
          onClick={handleLogout}
          title="Logout"
          aria-label="Logout"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
