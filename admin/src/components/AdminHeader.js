import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { useMobileSidebar } from './Sidebar';

export default function AdminHeader({ title }) {
  const navigate = useNavigate();
  const toggleMobile = useMobileSidebar();
  const user = JSON.parse(localStorage.getItem('admin_user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    navigate('/login');
  };

  const initials = user.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'A';

  const roleBadgeClass = `badge badge-${user.role || 'user'}`;

  return (
    <header className="admin-header">
      <div className="admin-header-left">
        <button className="mobile-menu-toggle" onClick={toggleMobile}>
          <Menu size={20} />
        </button>
        <h1>{title || 'Admin Panel'}</h1>
      </div>

      <div className="admin-header-right">
        <div className="header-user-info">
          <div>
            <div className="header-user-name">{user.name || 'Admin'}</div>
            <div className="header-user-email">{user.email || ''}</div>
          </div>
          <span className={roleBadgeClass}>
            {(user.role || 'admin').replace('_', ' ')}
          </span>
          <div className="header-avatar">{initials}</div>
        </div>
        <button className="header-logout-btn" onClick={handleLogout}>
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </header>
  );
}
