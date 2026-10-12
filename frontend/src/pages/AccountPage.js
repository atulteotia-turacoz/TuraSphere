import React, { useState, useEffect, useCallback } from 'react';
import {
  User, CreditCard, FileText, Package, Check, AlertTriangle,
  Download, Edit2, X, RefreshCw, Crown, Calendar, Mail, Building,
  Settings, CheckSquare, Square, Plus, Trash2, Zap, Tag, Video, Send, Twitter, Layers, Globe, BookOpen } from 'lucide-react';
import KolTiersTab from './account/KolTiersTab';
import CategoriesTab from './account/CategoriesTab';
import SmtpConfigTab from './account/SmtpConfigTab';
import MeetingPlatformsTab from './account/MeetingPlatformsTab';
import TwitterTab from './account/TwitterTab';
import { GoogleSearchTab, GoogleScholarTab } from './account/SearchKeyTabs';
import EmailLogsTab from './account/EmailLogsTab';
import {
  getProfile, updateProfile, getBilling, updateBilling,
  getSubscription, getInvoices, downloadInvoicePdf,
  cancelSubscription, subscribe, getPlans,
  getAssessmentParameters, updateAssessmentParameters,
  createCustomParameter, updateCustomParameter, deleteCustomParameter,
} from '../services/api';

// Eleven settings panes, grouped. Flat, they were an eleven-item strip that
// wrapped onto two rows and gave no sense of what belonged with what.
const TAB_GROUPS = [
  {
    label: 'Account',
    tabs: [
      { key: 'profile', label: 'Profile', icon: User },
      { key: 'subscription', label: 'Subscription', icon: Package },
      { key: 'billing', label: 'Billing', icon: CreditCard },
      { key: 'invoices', label: 'Invoices', icon: FileText },
    ],
  },
  {
    label: 'Configuration',
    tabs: [
      { key: 'parameters', label: 'Assessment Parameters', icon: Settings },
      { key: 'categories', label: 'Categories', icon: Tag },
      { key: 'kol-tiers', label: 'KOL Tiers', icon: Layers },
    ],
  },
  {
    label: 'Integrations',
    tabs: [
      { key: 'email-smtp', label: 'Email (SMTP)', icon: Send },
      { key: 'meeting-platforms', label: 'Meeting Platforms', icon: Video },
      { key: 'twitter', label: 'X (Twitter)', icon: Twitter },
      { key: 'google-search', label: 'Google Search', icon: Globe },
      { key: 'google-scholar', label: 'Google Scholar', icon: BookOpen },
      { key: 'email-logs', label: 'Email Logs', icon: Mail },
    ],
  },
];

// Derived, not hand-listed: a tab added to TAB_GROUPS but missed here would
// have silently stopped its own deep link from resolving.
const TAB_KEYS = TAB_GROUPS.flatMap((g) => g.tabs).map((t) => t.key);
// Hash format: "#tab" or "#tab/subkey" (subkey is owned by the child component).
const tabFromHash = () => {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  const top = h.split('/')[0];
  return TAB_KEYS.includes(top) ? top : 'profile';
};

export default function AccountPage() {
  const [tab, setTabState] = useState(tabFromHash);
  const setTab = (next) => {
    setTabState(next);
    // Replace only the top-level segment; let child components keep their subkey
    // when switching back to the same tab elsewhere.
    if (typeof window !== 'undefined') {
      const current = window.location.hash.replace(/^#/, '');
      if (current.split('/')[0] !== next) {
        window.history.replaceState(null, '', `#${next}`);
      }
    }
  };
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [profile, setProfile] = useState(null);
  const [billing, setBilling] = useState(null);
  const [subscription, setSub] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Profile form
  const [profileForm, setProfileForm] = useState({ full_name: '', organization: '' });
  const [editingProfile, setEditingProfile] = useState(false);

  // Billing form
  const [billingForm, setBillingForm] = useState({
    company_name: '', address_line1: '', address_line2: '',
    city: '', state: '', zip_code: '', country: '', tax_id: '', phone: '',
  });
  const [editingBilling, setEditingBilling] = useState(false);

  // Assessment parameters
  const [parameters, setParameters] = useState([]);
  const [paramSaving, setParamSaving] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState(null);
  const [customForm, setCustomForm] = useState({ category: '', code: '', name: '', description: '', max_score: 0, sort_order: 0 });
  const [customSaving, setCustomSaving] = useState(false);
  const [deleteCustomConfirm, setDeleteCustomConfirm] = useState(null);

  // Subscribe modal
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState('monthly');

  const fetchAll = useCallback(async () => {
    try {
      const [profRes, billRes, subRes, invRes, planRes, paramRes] = await Promise.all([
        getProfile(), getBilling(), getSubscription(), getInvoices(), getPlans(), getAssessmentParameters(),
      ]);
      setProfile(profRes.data);
      setProfileForm({ full_name: profRes.data.full_name || '', organization: profRes.data.organization || '' });
      setBilling(billRes.data);
      setBillingForm({
        company_name: billRes.data.company_name || '', address_line1: billRes.data.address_line1 || '',
        address_line2: billRes.data.address_line2 || '', city: billRes.data.city || '',
        state: billRes.data.state || '', zip_code: billRes.data.zip_code || '',
        country: billRes.data.country || '', tax_id: billRes.data.tax_id || '',
        phone: billRes.data.phone || '',
      });
      setSub(subRes.data.subscription);
      setInvoices(invRes.data);
      setPlans(planRes.data);
      setParameters(paramRes.data || []);
    } catch (err) {
      console.error('Failed to load account data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const handleSaveProfile = async () => {
    setSaving(true); setError('');
    try {
      const res = await updateProfile(profileForm);
      setProfile(res.data);
      setEditingProfile(false);
      setSuccess('Profile updated successfully');
    } catch (err) {
      setError('Failed to update profile');
    } finally { setSaving(false); }
  };

  const handleSaveBilling = async () => {
    setSaving(true); setError('');
    try {
      const res = await updateBilling(billingForm);
      setBilling(res.data);
      setEditingBilling(false);
      setSuccess('Billing details updated successfully');
    } catch (err) {
      setError('Failed to update billing details');
    } finally { setSaving(false); }
  };

  const handleSubscribe = async () => {
    if (!selectedPlan) return;
    setSaving(true); setError('');
    try {
      await subscribe({ plan_id: selectedPlan.id, billing_cycle: billingCycle });
      setShowSubscribeModal(false);
      setSuccess(`Subscribed to ${selectedPlan.name} successfully!`);
      fetchAll();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to subscribe');
    } finally { setSaving(false); }
  };

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel your subscription?')) return;
    try {
      await cancelSubscription();
      setSuccess('Subscription cancelled');
      fetchAll();
    } catch (err) {
      setError('Failed to cancel subscription');
    }
  };

  const handleDownloadInvoice = async (invoice) => {
    try {
      const res = await downloadInvoicePdf(invoice.id);
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download invoice');
    }
  };

  const handleToggleParam = (paramId) => {
    setParameters((prev) =>
      prev.map((p) => (p.id === paramId ? { ...p, is_enabled: !p.is_enabled } : p))
    );
  };

  const handleToggleCategory = (category, enable) => {
    setParameters((prev) =>
      prev.map((p) => (p.category === category ? { ...p, is_enabled: enable } : p))
    );
  };

  const handleSaveParameters = async () => {
    setParamSaving(true); setError('');
    try {
      await updateAssessmentParameters({
        preferences: parameters.map((p) => ({ parameter_id: p.id, is_enabled: p.is_enabled })),
      });
      setSuccess('Assessment parameters updated successfully');
    } catch (err) {
      setError('Failed to update assessment parameters');
    } finally { setParamSaving(false); }
  };

  const openCustomCreate = () => {
    setEditingCustomId(null);
    setCustomForm({ category: 'Custom Parameters', code: '', name: '', description: '', max_score: 0, sort_order: 99 });
    setShowCustomModal(true);
  };

  const openCustomEdit = (p) => {
    setEditingCustomId(p.id);
    setCustomForm({ category: p.category, code: p.code, name: p.name, description: p.description || '', max_score: p.max_score, sort_order: p.sort_order });
    setShowCustomModal(true);
  };

  const handleSaveCustom = async () => {
    if (!customForm.code || !customForm.name) { setError('Code and Name are required'); return; }
    setCustomSaving(true); setError('');
    try {
      if (editingCustomId) {
        await updateCustomParameter(editingCustomId, customForm);
        setSuccess('Custom parameter updated');
      } else {
        await createCustomParameter(customForm);
        setSuccess('Custom parameter created');
      }
      setShowCustomModal(false);
      const paramRes = await getAssessmentParameters();
      setParameters(paramRes.data || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save custom parameter');
    } finally { setCustomSaving(false); }
  };

  const handleDeleteCustom = async (id) => {
    try {
      await deleteCustomParameter(id);
      setSuccess('Custom parameter deleted');
      setDeleteCustomConfirm(null);
      const paramRes = await getAssessmentParameters();
      setParameters(paramRes.data || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete custom parameter');
    }
  };

  const parseFeatures = (f) => { try { return JSON.parse(f || '[]'); } catch { return []; } };

  if (loading) return <div className="page container"><div className="loading-spinner"><div className="spinner" /></div></div>;

  return (
    <div className="page container">
      <div className="page-header">
        <h1 className="sr-only">My Account</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>Manage your profile, subscription, and billing</p>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Account settings">
          {TAB_GROUPS.map((group) => (
            <React.Fragment key={group.label}>
              <div className="settings-group-label">{group.label}</div>
              {group.tabs.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={`settings-tab ${tab === t.key ? 'active' : ''}`}
                    onClick={() => setTab(t.key)}
                    aria-current={tab === t.key ? 'page' : undefined}
                  >
                    <Icon size={16} /> {t.label}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </nav>

        <div className="account-content">
        {/* ── Profile Tab ── */}
        {tab === 'profile' && profile && (
          <div className="account-card">
            <div className="account-card-header">
              <h3><User size={20} /> Profile Information</h3>
              {!editingProfile && (
                <button className="btn btn-sm btn-outline" onClick={() => setEditingProfile(true)}>
                  <Edit2 size={14} /> Edit
                </button>
              )}
            </div>
            {editingProfile ? (
              <div className="account-card-body">
                <div className="form-group">
                  <label>Full Name</label>
                  <input className="form-control" value={profileForm.full_name}
                    onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Organization</label>
                  <input className="form-control" value={profileForm.organization}
                    onChange={(e) => setProfileForm({ ...profileForm, organization: e.target.value })} />
                </div>
                <div className="form-group" style={{ display: 'flex', gap: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveProfile} disabled={saving}>
                    {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : 'Save Changes'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingProfile(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="account-card-body">
                <div className="profile-detail"><Mail size={16} /> <span className="profile-label">Email</span> <span>{profile.email}</span></div>
                <div className="profile-detail"><User size={16} /> <span className="profile-label">Name</span> <span>{profile.full_name}</span></div>
                <div className="profile-detail"><Building size={16} /> <span className="profile-label">Organization</span> <span>{profile.organization || '—'}</span></div>
                <div className="profile-detail"><Calendar size={16} /> <span className="profile-label">Member since</span> <span>{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</span></div>
              </div>
            )}
          </div>
        )}

        {/* ── Subscription Tab ── */}
        {tab === 'subscription' && (
          <div>
            {subscription ? (
              <div className="account-card">
                <div className="account-card-header">
                  <h3><Crown size={20} /> Current Plan</h3>
                  <span className={`badge ${subscription.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                    {subscription.status}
                  </span>
                </div>
                <div className="account-card-body">
                  <div className="current-plan-info">
                    <h2 className="current-plan-name">{subscription.plan_name}</h2>
                    <div className="current-plan-price">
                      ${subscription.plan_price} / {subscription.billing_cycle}
                    </div>
                  </div>
                  <div className="profile-detail">
                    <Calendar size={16} />
                    <span className="profile-label">Current Period</span>
                    <span>
                      {subscription.current_period_start ? new Date(subscription.current_period_start).toLocaleDateString() : '—'}
                      {' — '}
                      {subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  {subscription.plan_features && (
                    <div className="current-plan-features">
                      <h4>Plan Features</h4>
                      <ul>
                        {parseFeatures(subscription.plan_features).map((f, i) => (
                          <li key={i}><Check size={14} style={{ color: 'var(--color-success)' }} /> {f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setShowSubscribeModal(true); }}>
                      Change Plan
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={handleCancel}>
                      Cancel Subscription
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="account-card">
                <div className="account-card-body" style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <Package size={48} style={{ color: 'var(--color-text-light)', marginBottom: 16 }} />
                  <h3>No Active Subscription</h3>
                  <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                    Choose a plan to unlock full KOL assessment features.
                  </p>
                  <button className="btn btn-primary" onClick={() => setShowSubscribeModal(true)}>
                    Choose a Plan
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Billing Tab ── */}
        {tab === 'billing' && billing && (
          <div className="account-card">
            <div className="account-card-header">
              <h3><CreditCard size={20} /> Billing Details</h3>
              {!editingBilling && (
                <button className="btn btn-sm btn-outline" onClick={() => setEditingBilling(true)}>
                  <Edit2 size={14} /> Edit
                </button>
              )}
            </div>
            {editingBilling ? (
              <div className="account-card-body">
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginBottom: 16 }}>
                  These details will appear on your invoices.
                </p>
                <div className="form-group">
                  <label>Company Name</label>
                  <input className="form-control" value={billingForm.company_name}
                    onChange={(e) => setBillingForm({ ...billingForm, company_name: e.target.value })} />
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label>Address Line 1</label>
                    <input className="form-control" value={billingForm.address_line1}
                      onChange={(e) => setBillingForm({ ...billingForm, address_line1: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Address Line 2</label>
                    <input className="form-control" value={billingForm.address_line2}
                      onChange={(e) => setBillingForm({ ...billingForm, address_line2: e.target.value })} />
                  </div>
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label>City</label>
                    <input className="form-control" value={billingForm.city}
                      onChange={(e) => setBillingForm({ ...billingForm, city: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>State / Province</label>
                    <input className="form-control" value={billingForm.state}
                      onChange={(e) => setBillingForm({ ...billingForm, state: e.target.value })} />
                  </div>
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label>ZIP / Postal Code</label>
                    <input className="form-control" value={billingForm.zip_code}
                      onChange={(e) => setBillingForm({ ...billingForm, zip_code: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Country</label>
                    <input className="form-control" value={billingForm.country}
                      onChange={(e) => setBillingForm({ ...billingForm, country: e.target.value })} />
                  </div>
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label>Tax ID / GST Number</label>
                    <input className="form-control" value={billingForm.tax_id}
                      onChange={(e) => setBillingForm({ ...billingForm, tax_id: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input className="form-control" value={billingForm.phone}
                      onChange={(e) => setBillingForm({ ...billingForm, phone: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveBilling} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Billing Details'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingBilling(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="account-card-body">
                <div className="profile-detail"><Building size={16} /> <span className="profile-label">Company</span> <span>{billing.company_name || '—'}</span></div>
                <div className="profile-detail"><span className="profile-label" style={{ marginLeft: 26 }}>Address</span> <span>{[billing.address_line1, billing.address_line2, billing.city, billing.state, billing.zip_code, billing.country].filter(Boolean).join(', ') || '—'}</span></div>
                <div className="profile-detail"><span className="profile-label" style={{ marginLeft: 26 }}>Tax ID</span> <span>{billing.tax_id || '—'}</span></div>
                <div className="profile-detail"><span className="profile-label" style={{ marginLeft: 26 }}>Phone</span> <span>{billing.phone || '—'}</span></div>
              </div>
            )}
          </div>
        )}

        {/* ── Invoices Tab ── */}
        {tab === 'invoices' && (
          <div className="account-card">
            <div className="account-card-header">
              <h3><FileText size={20} /> Invoices</h3>
            </div>
            <div className="account-card-body" style={{ padding: 0 }}>
              {invoices.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <FileText size={40} style={{ color: 'var(--color-text-light)', marginBottom: 12 }} />
                  <p style={{ color: 'var(--color-text-secondary)' }}>No invoices yet</p>
                </div>
              ) : (
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Plan</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-mono">{inv.invoice_number}</td>
                        <td>{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}</td>
                        <td>{inv.plan_name} ({inv.billing_cycle})</td>
                        <td><strong>{inv.currency} {inv.amount.toFixed(2)}</strong></td>
                        <td>
                          <span className={`badge badge-${inv.status === 'paid' ? 'success' : inv.status === 'pending' ? 'warning' : 'danger'}`}>
                            {inv.status}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-ghost" onClick={() => handleDownloadInvoice(inv)}>
                            <Download size={14} /> PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
        {/* ── Assessment Parameters Tab ── */}
        {tab === 'parameters' && (() => {
          const baseParams = parameters.filter((p) => p.is_standard && !p.is_additional);
          const additionalParams = parameters.filter((p) => p.is_standard && p.is_additional);
          const customParams = parameters.filter((p) => !p.is_standard);
          const renderCategoryBlock = (catParams, cat, opts = {}) => {
            const allEnabled = catParams.every((p) => p.is_enabled);
            const someEnabled = catParams.some((p) => p.is_enabled);
            return (
              <div key={cat} className="param-category" style={{ marginBottom: 24 }}>
                <div
                  className="param-category-header"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
                    padding: '10px 14px', background: 'var(--color-bg-secondary, var(--color-bg))',
                    borderRadius: 8, cursor: 'pointer',
                  }}
                  onClick={() => handleToggleCategory(cat, !allEnabled)}
                >
                  {allEnabled ? (
                    <CheckSquare size={18} style={{ color: 'var(--color-primary)' }} />
                  ) : someEnabled ? (
                    <CheckSquare size={18} style={{ color: 'var(--color-text-light)' }} />
                  ) : (
                    <Square size={18} style={{ color: 'var(--color-text-light)' }} />
                  )}
                  <strong style={{ fontSize: '0.95rem' }}>{cat}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                    {catParams.filter((p) => p.is_enabled).length}/{catParams.length} selected
                  </span>
                </div>
                <div style={{ paddingLeft: 8 }}>
                  {catParams.map((p) => (
                    <div
                      key={p.id}
                      className="param-item"
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 14px',
                        borderBottom: '1px solid var(--color-border-light, var(--color-border))', cursor: 'pointer',
                      }}
                      onClick={() => handleToggleParam(p.id)}
                    >
                      {p.is_enabled ? (
                        <CheckSquare size={16} style={{ color: 'var(--color-primary)', marginTop: 2, flexShrink: 0 }} />
                      ) : (
                        <Square size={16} style={{ color: 'var(--color-text-light)', marginTop: 2, flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{p.name}</div>
                        {p.description && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                            {p.description}
                          </div>
                        )}
                      </div>
                      {p.max_score > 0 && (
                        <span style={{
                          fontSize: '0.75rem', background: 'var(--color-primary-light, var(--color-info-bg))',
                          color: 'var(--color-primary)', padding: '2px 8px', borderRadius: 12,
                          whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                          Max: {p.max_score}
                        </span>
                      )}
                      {opts.showActions && !p.is_standard && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-sm btn-ghost" onClick={() => openCustomEdit(p)} title="Edit">
                            <Edit2 size={13} />
                          </button>
                          {deleteCustomConfirm === p.id ? (
                            <>
                              <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCustom(p.id)}>Yes</button>
                              <button className="btn btn-sm btn-ghost" onClick={() => setDeleteCustomConfirm(null)}>No</button>
                            </>
                          ) : (
                            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--color-error)' }}
                              onClick={() => setDeleteCustomConfirm(p.id)} title="Delete">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          };

          const baseCategories = [...new Set(baseParams.map((p) => p.category))];
          const additionalCategories = [...new Set(additionalParams.map((p) => p.category))];
          const customCategories = [...new Set(customParams.map((p) => p.category))];

          return (
            <>
              {/* Standard Parameters (Base Criteria) */}
              <div className="account-card">
                <div className="account-card-header">
                  <h3><Settings size={20} /> Standard Parameters</h3>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveParameters} disabled={paramSaving}>
                    {paramSaving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : 'Save Preferences'}
                  </button>
                </div>
                <div className="account-card-body">
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginBottom: 20 }}>
                    Base criteria for KOL assessment (Selection Criteria + C.1–C.4). All checked by default.
                  </p>
                  {baseParams.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <Settings size={40} style={{ color: 'var(--color-text-light)', marginBottom: 12 }} />
                      <p style={{ color: 'var(--color-text-secondary)' }}>No standard parameters configured</p>
                    </div>
                  ) : (
                    baseCategories.map((cat) => renderCategoryBlock(baseParams.filter((p) => p.category === cat), cat))
                  )}
                </div>
              </div>

              {/* Additional Parameters (Advanced Metrics C.5–C.9 Bonus) */}
              <div className="account-card" style={{ marginTop: 24 }}>
                <div className="account-card-header">
                  <h3><Zap size={20} /> Additional Parameters</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary, var(--color-bg))', padding: '4px 12px', borderRadius: 12 }}>
                    Advanced Metrics (0-15pts BONUS)
                  </span>
                </div>
                <div className="account-card-body">
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginBottom: 20 }}>
                    Phase 2/3 bonus scoring criteria (C.5–C.9). These are unchecked by default — enable the ones you need.
                  </p>
                  {additionalParams.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <Zap size={40} style={{ color: 'var(--color-text-light)', marginBottom: 12 }} />
                      <p style={{ color: 'var(--color-text-secondary)' }}>No additional parameters configured</p>
                    </div>
                  ) : (
                    additionalCategories.map((cat) => renderCategoryBlock(additionalParams.filter((p) => p.category === cat), cat))
                  )}
                </div>
              </div>

              {/* Custom Parameters */}
              <div className="account-card" style={{ marginTop: 24 }}>
                <div className="account-card-header">
                  <h3><Plus size={20} /> My Custom Parameters</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={openCustomCreate}>
                      <Plus size={14} /> Add Parameter
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveParameters} disabled={paramSaving}>
                      {paramSaving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : 'Save Preferences'}
                    </button>
                  </div>
                </div>
                <div className="account-card-body">
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem', marginBottom: 20 }}>
                    Create your own custom parameters. You can edit and delete only the parameters you've added.
                  </p>
                  {customParams.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <Plus size={40} style={{ color: 'var(--color-text-light)', marginBottom: 12 }} />
                      <p style={{ color: 'var(--color-text-secondary)' }}>No custom parameters yet</p>
                      <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={openCustomCreate}>
                        <Plus size={14} /> Add Your First Parameter
                      </button>
                    </div>
                  ) : (
                    customCategories.map((cat) =>
                      renderCategoryBlock(customParams.filter((p) => p.category === cat), cat, { showActions: true })
                    )
                  )}
                </div>
              </div>

              {/* Custom Parameter Modal */}
              {showCustomModal && (
                <div className="modal-overlay" onClick={() => setShowCustomModal(false)}>
                  <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
                    <div className="modal-header">
                      <h3>{editingCustomId ? 'Edit Custom Parameter' : 'Add Custom Parameter'}</h3>
                      <button className="modal-close" onClick={() => setShowCustomModal(false)}><X size={18} /></button>
                    </div>
                    <div className="modal-body">
                      <div className="form-group">
                        <label>Category</label>
                        <input className="form-control" value={customForm.category}
                          onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })} placeholder="e.g. Custom Parameters" />
                      </div>
                      <div className="form-group">
                        <label>Code * <small style={{ color: 'var(--color-text-secondary)' }}>(unique identifier)</small></label>
                        <input className="form-control" value={customForm.code}
                          onChange={(e) => setCustomForm({ ...customForm, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} placeholder="e.g. CUSTOM_MY_PARAM" />
                      </div>
                      <div className="form-group">
                        <label>Name *</label>
                        <input className="form-control" value={customForm.name}
                          onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Description</label>
                        <textarea className="form-control" rows={3} value={customForm.description}
                          onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })} />
                      </div>
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div className="form-group" style={{ flex: 1 }}>
                          <label>Max Score</label>
                          <input className="form-control" type="number" step="0.5" min="0" value={customForm.max_score}
                            onChange={(e) => setCustomForm({ ...customForm, max_score: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                          <label>Sort Order</label>
                          <input className="form-control" type="number" min="0" value={customForm.sort_order}
                            onChange={(e) => setCustomForm({ ...customForm, sort_order: parseInt(e.target.value) || 0 })} />
                        </div>
                      </div>
                    </div>
                    <div className="modal-footer">
                      <button className="btn btn-ghost" onClick={() => setShowCustomModal(false)}>Cancel</button>
                      <button className="btn btn-primary" disabled={customSaving} onClick={handleSaveCustom}>
                        {customSaving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : editingCustomId ? 'Update' : 'Create'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* ── KOL Tiers Tab ── */}
        {tab === 'kol-tiers' && <KolTiersTab />}

        {/* ── Categories Tab ── */}
        {tab === 'categories' && (
          <CategoriesTab
            onNotice={(level, msg) => {
              if (level === 'success') setSuccess(msg);
              else setError(msg);
            }}
          />
        )}

        {/* ── Email (SMTP) Tab ── */}
        {tab === 'email-smtp' && (
          <SmtpConfigTab
            onNotice={(level, msg) => {
              if (level === 'success') setSuccess(msg);
              else setError(msg);
            }}
          />
        )}

        {/* ── Meeting Platforms Tab ── */}
        {tab === 'meeting-platforms' && (
          <MeetingPlatformsTab
            onNotice={(level, msg) => {
              if (level === 'success') setSuccess(msg);
              else setError(msg);
            }}
          />
        )}

        {/* ── X (Twitter) Tab ── */}
        {tab === 'twitter' && (
          <TwitterTab
            onNotice={(level, msg) => {
              if (level === 'success') setSuccess(msg);
              else setError(msg);
            }}
          />
        )}

        {/* ── Google Search / Google Scholar (own SerpAPI key) ── */}
        {tab === 'google-search' && (
          <GoogleSearchTab onNotice={(level, msg) => (level === 'success' ? setSuccess(msg) : setError(msg))} />
        )}
        {tab === 'google-scholar' && (
          <GoogleScholarTab onNotice={(level, msg) => (level === 'success' ? setSuccess(msg) : setError(msg))} />
        )}

        {/* ── Email Logs Tab ── */}
        {tab === 'email-logs' && <EmailLogsTab onNotice={(level, msg) => {
          if (level === 'success') setSuccess(msg);
          else setError(msg);
        }} />}
        </div>
      </div>

      {/* ── Subscribe / Change Plan Modal ── */}
      {showSubscribeModal && (
        <div className="modal-overlay" onClick={() => setShowSubscribeModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Choose a Plan</h3>
              <button className="modal-close" onClick={() => setShowSubscribeModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="subscribe-cycle-toggle">
                <button className={`pricing-toggle-btn ${billingCycle === 'monthly' ? 'active' : ''}`}
                  onClick={() => setBillingCycle('monthly')}>Monthly</button>
                <button className={`pricing-toggle-btn ${billingCycle === 'yearly' ? 'active' : ''}`}
                  onClick={() => setBillingCycle('yearly')}>Yearly (Save 20%)</button>
              </div>
              <div className="subscribe-plans-grid">
                {plans.map((plan) => {
                  const price = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;
                  const perMonth = billingCycle === 'yearly' ? Math.round(plan.price_yearly / 12) : plan.price_monthly;
                  const isCurrentPlan = subscription && subscription.plan_id === plan.id;
                  const features = parseFeatures(plan.features);
                  return (
                    <div
                      key={plan.id}
                      className={`subscribe-plan-card ${selectedPlan?.id === plan.id ? 'selected' : ''} ${plan.is_popular ? 'popular' : ''} ${isCurrentPlan ? 'current' : ''}`}
                      onClick={() => !isCurrentPlan && setSelectedPlan(plan)}
                    >
                      {isCurrentPlan && <div className="subscribe-current-badge">Current Plan</div>}
                      {plan.badge_text && !isCurrentPlan && <div className="subscribe-badge">{plan.badge_text}</div>}
                      <h4>{plan.name}</h4>
                      <div className="subscribe-price">
                        {price === 0 ? 'Free' : <><span>$</span>{perMonth}<small>/mo</small></>}
                      </div>
                      <ul className="subscribe-features">
                        {features.slice(0, 5).map((f, i) => (
                          <li key={i}><Check size={13} /> {f}</li>
                        ))}
                        {features.length > 5 && <li className="more">+{features.length - 5} more</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowSubscribeModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!selectedPlan || saving} onClick={handleSubscribe}>
                {saving ? 'Processing...' : selectedPlan ? `Subscribe to ${selectedPlan.name}` : 'Select a Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
