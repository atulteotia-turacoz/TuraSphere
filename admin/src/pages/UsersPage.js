import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Edit2, Trash2, X, Search, AlertTriangle, Check, RefreshCw,
  ToggleLeft, ToggleRight, FileText, BarChart3, ClipboardCheck, Users, Eye,
} from 'lucide-react';
import { listUsers, createUser, updateUser, deleteUser } from '../services/api';

const ROLES = ['user', 'admin', 'super_admin'];

const ALL_SERVICES = [
  { slug: 'assessments', label: 'KOL' },
  { slug: 'find_kols', label: 'Find KOLs' },
  { slug: 'surveys', label: 'Surveys' },
  { slug: 'polling', label: 'Polling' },
  { slug: 'assessment_forms', label: 'Assessment Forms' },
  { slug: 'advisory_boards', label: 'Advisory Boards' },
  { slug: 'publications', label: 'Publications' },
  { slug: 'consensus', label: 'Consensus' },
  { slug: 'recent_guidelines', label: 'Recent Guidelines' },
];

export default function UsersPage({ showCreateModal }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [formData, setFormData] = useState({
    full_name: '', email: '', password: '', role: 'user', organization: '', is_active: true, ai_enabled: true, granted_services: [],
  });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [success, setSuccess] = useState('');

  const fetchUsers = useCallback(async () => {
    try { const res = await listUsers({ search }); setUsers(res.data?.users || res.data || []); }
    catch (err) { console.error('Failed to fetch users', err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { if (showCreateModal) openCreateModal(); }, [showCreateModal]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); } }, [success]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ full_name: '', email: '', password: '', role: 'user', organization: '', is_active: true, ai_enabled: true, granted_services: [] });
    setFormError(''); setModalOpen(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    let services = [];
    // The list endpoint sends the raw JSON column (a string); the detail
    // endpoint sends a resolved list. Accept either rather than silently
    // falling back to [] and showing an entitled user as having no grants.
    try {
      const raw = user.granted_services;
      services = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []);
    } catch { services = []; }
    setFormData({
      full_name: user.full_name || '', email: user.email || '', password: '', role: user.role || 'user',
      organization: user.organization || '', is_active: user.is_active !== false,
      granted_services: Array.isArray(services) ? services : [],
      ai_enabled: user.ai_enabled !== false,
    });
    setFormError(''); setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setFormError(''); setFormLoading(true);
    try {
      if (editingUser) {
        await updateUser(editingUser.id, {
          full_name: formData.full_name, organization: formData.organization,
          is_active: formData.is_active, role: formData.role,
          // `[]` not `null` — null is "unrestricted" server-side, so clearing every
          // checkbox would hand the user every module instead of none.
          granted_services: formData.granted_services,
        });
        setSuccess('User updated');
      } else {
        if (!formData.password) { setFormError('Password is required.'); setFormLoading(false); return; }
        if (!formData.full_name || !formData.email) { setFormError('Name and email are required.'); setFormLoading(false); return; }
        await createUser({
          full_name: formData.full_name, email: formData.email, password: formData.password,
          role: formData.role, organization: formData.organization || null,
          // `[]` not `null` — null is "unrestricted" server-side, so clearing every
          // checkbox would hand the user every module instead of none.
          granted_services: formData.granted_services,
        });
        setSuccess('User created');
      }
      setModalOpen(false); fetchUsers();
    } catch (err) { setFormError(err.response?.data?.detail || 'Failed to save.'); }
    finally { setFormLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try { await deleteUser(deleteConfirm.id); setDeleteConfirm(null); setSuccess('User deleted'); fetchUsers(); }
    catch { setFormError('Failed to delete'); }
  };

  const handleToggleAi = async (user) => {
    const turningOff = user.ai_enabled !== false;
    if (turningOff && !window.confirm(
      `Turn AI off for ${user.full_name}?\n\n`
      + '• CV upload and bulk paste keep working — a rule engine reads the CV instead\n'
      + '  of a model. Check the fields it fills before saving.\n'
      + '• The 26 CV-based parameters get scored by deterministic rules instead.\n'
      + '• Four judgement-based parameters will need manual review.\n\n'
      + 'No CV content will leave the system for this account.')) return;
    try {
      await updateUser(user.id, { ai_enabled: !(user.ai_enabled !== false) });
      setSuccess(`AI ${turningOff ? 'disabled' : 'enabled'} for ${user.full_name}`);
      fetchUsers();
    } catch { setFormError('Failed to change the AI setting'); }
  };

  const handleToggleActive = async (user) => {
    try { await updateUser(user.id, { is_active: !user.is_active }); setSuccess(`User ${user.is_active ? 'deactivated' : 'activated'}`); fetchUsers(); }
    catch { console.error('Failed to toggle'); }
  };

  const handleInputChange = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));
  const toggleFormService = (slug) => {
    setFormData(prev => ({
      ...prev, granted_services: prev.granted_services.includes(slug)
        ? prev.granted_services.filter(s => s !== slug) : [...prev.granted_services, slug],
    }));
  };

  const filteredUsers = Array.isArray(users) ? users.filter(u =>
    (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.organization || '').toLowerCase().includes(search.toLowerCase())
  ) : [];

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage users, roles, services, and access</p>
        </div>
        <button className="btn btn-primary" onClick={openCreateModal}><Plus size={16} /> Add User</button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}

      <div className="table-container">
        <div className="table-header">
          <h3>All Users ({filteredUsers.length})</h3>
          <div className="table-actions">
            <div className="table-search">
              <Search className="search-icon" size={16} />
              <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => { setLoading(true); fetchUsers(); }}><RefreshCw size={14} /> Refresh</button>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Services</th><th>Status</th><th>AI</th><th>Created</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length > 0 ? filteredUsers.map(user => {
                let userServices = [];
                try { userServices = user.granted_services ? JSON.parse(user.granted_services) : []; } catch { userServices = []; }
                if (!Array.isArray(userServices)) userServices = [];
                return (
                  <tr key={user.id}>
                    <td className="font-mono">{user.id}</td>
                    <td><strong>{user.full_name || '--'}</strong></td>
                    <td>{user.email}</td>
                    <td><span className={`badge badge-${user.role}`}>{(user.role || 'user').replace('_', ' ')}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {userServices.length === 0 ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>All</span>
                        ) : userServices.map(s => (
                          <span key={s} style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: 4, background: 'var(--primary-light)', color: 'var(--primary)', fontWeight: 500 }}>
                            {s.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="btn-icon" title="Toggle status" onClick={() => handleToggleActive(user)}>
                        {user.is_active !== false ? <ToggleRight size={20} style={{ color: 'var(--success)' }} /> : <ToggleLeft size={20} style={{ color: 'var(--danger)' }} />}
                      </button>
                      <span className={`badge ${user.is_active !== false ? 'badge-active' : 'badge-inactive'}`}>
                        {user.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {/* Governs CV extraction AND rubric scoring for this
                          account. Off = no CV content reaches a model and the
                          26 CV parameters are scored by rule instead. */}
                      <button
                        className="btn-icon"
                        title={user.ai_enabled === false
                          ? 'AI is OFF — CV upload disabled, parameters scored by rules. Click to enable.'
                          : 'AI is ON — CVs read by AI, 83 of 137 points scored by AI. Click to disable.'}
                        onClick={() => handleToggleAi(user)}
                      >
                        {user.ai_enabled === false
                          ? <ToggleLeft size={20} style={{ color: 'var(--text-muted)' }} />
                          : <ToggleRight size={20} style={{ color: 'var(--success)' }} />}
                      </button>
                      <span className={`badge ${user.ai_enabled === false ? 'badge-inactive' : 'badge-active'}`}>
                        {user.ai_enabled === false ? 'Rules' : 'AI'}
                      </span>
                    </td>
                    <td className="text-muted" style={{ fontSize: '0.78rem' }}>
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        {user.role !== 'super_admin' && (
                          <button className="btn-icon" title="View Details" onClick={() => navigate(`/users/${user.id}`)}>
                            <Eye size={16} />
                          </button>
                        )}
                        <button className="btn-icon" title="Edit" onClick={() => openEditModal(user)}>
                          <Edit2 size={16} />
                        </button>
                        {user.role !== 'super_admin' && (
                          <button className="btn-icon danger" title="Delete" onClick={() => setDeleteConfirm(user)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} className="table-empty"><p>No users found</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>Showing {filteredUsers.length} user(s)</span></div>
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{editingUser ? 'Edit User' : 'Create New User'}</h3>
              <button className="modal-close" onClick={() => setModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div className="alert alert-danger"><AlertTriangle size={14} /> {formError}</div>}
                <div className="form-group">
                  <label>Full Name *</label>
                  <input className="form-control" placeholder="John Doe" value={formData.full_name}
                    onChange={e => handleInputChange('full_name', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Email Address *</label>
                  <input className="form-control" type="email" placeholder="john@example.com" value={formData.email}
                    onChange={e => handleInputChange('email', e.target.value)} required disabled={!!editingUser} />
                </div>
                {!editingUser && (
                  <div className="form-group">
                    <label>Password *</label>
                    <input className="form-control" type="password" placeholder="Enter password" value={formData.password}
                      onChange={e => handleInputChange('password', e.target.value)} />
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label>Role</label>
                    <select className="form-control" value={formData.role} onChange={e => handleInputChange('role', e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Organization</label>
                    <input className="form-control" placeholder="Company name" value={formData.organization}
                      onChange={e => handleInputChange('organization', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Granted Modules</label>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                    What this account is entitled to. The user chooses which of these to switch
                    on from their own dashboard, and cannot give themselves any others.
                    Leave all unchecked for unrestricted access.
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ALL_SERVICES.map(svc => {
                      const isOn = formData.granted_services.includes(svc.slug);
                      return (
                        <button key={svc.slug} type="button" onClick={() => toggleFormService(svc.slug)}
                          style={{
                            padding: '5px 10px', borderRadius: 6, border: '1.5px solid', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500,
                            display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
                            borderColor: isOn ? 'var(--primary)' : 'var(--border-color)', background: isOn ? 'var(--primary-light)' : 'var(--content-card-bg)', color: isOn ? 'var(--primary)' : 'var(--text-secondary)',
                          }}>
                          {svc.label} {isOn && <Check size={12} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {editingUser && (
                  <div className="form-group">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={formData.is_active} onChange={e => handleInputChange('is_active', e.target.checked)} />
                      <span>Active</span>
                    </label>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={formLoading}>
                  {formLoading ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon"><AlertTriangle size={28} /></div>
              <h3>Delete User</h3>
              <p>Are you sure you want to delete <strong>{deleteConfirm.full_name || deleteConfirm.email}</strong>?</p>
              <div className="confirm-actions">
                <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
