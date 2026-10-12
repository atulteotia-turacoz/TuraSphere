import React, { useState, useEffect } from 'react';
import {
  Package, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  Star, RefreshCw, DollarSign, Eye, EyeOff,
} from 'lucide-react';
import {
  listPlans, createPlan, updatePlan, deletePlan,
  getSiteSettings, updateSiteSetting,
} from '../services/api';

const emptyForm = {
  name: '', slug: '', description: '', price_monthly: 0, price_yearly: 0,
  currency: 'USD', max_assessments: 0, max_hcps: 0, features: '',
  is_active: true, is_popular: false, sort_order: 0, badge_text: '',
};

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [featureLines, setFeatureLines] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showPricing, setShowPricing] = useState(false);
  const [togglingPricing, setTogglingPricing] = useState(false);

  const fetchPlans = async () => {
    try {
      const res = await listPlans();
      setPlans(res.data);
    } catch (err) {
      setError('Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await getSiteSettings();
      setShowPricing(res.data?.show_pricing === 'true');
    } catch {}
  };

  const togglePricing = async () => {
    setTogglingPricing(true);
    try {
      const newVal = !showPricing;
      await updateSiteSetting('show_pricing', String(newVal));
      setShowPricing(newVal);
      setSuccess(newVal ? 'Pricing section is now visible on the landing page' : 'Pricing section is now hidden from the landing page');
    } catch {
      setError('Failed to update pricing visibility');
    } finally {
      setTogglingPricing(false);
    }
  };

  useEffect(() => { fetchPlans(); fetchSettings(); }, []);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const parseFeatures = (f) => {
    try { return JSON.parse(f || '[]'); } catch { return []; }
  };

  const generateSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setFeatureLines('');
    setError('');
    setShowModal(true);
  };

  const openEdit = (plan) => {
    setEditId(plan.id);
    const features = parseFeatures(plan.features);
    setForm({
      name: plan.name, slug: plan.slug, description: plan.description || '',
      price_monthly: plan.price_monthly, price_yearly: plan.price_yearly,
      currency: plan.currency, max_assessments: plan.max_assessments,
      max_hcps: plan.max_hcps, features: plan.features || '',
      is_active: plan.is_active, is_popular: plan.is_popular,
      sort_order: plan.sort_order, badge_text: plan.badge_text || '',
    });
    setFeatureLines(features.join('\n'));
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Plan name is required'); return; }
    if (!form.slug.trim()) { setError('Slug is required'); return; }
    setSaving(true);
    setError('');
    const featuresArray = featureLines.split('\n').map(f => f.trim()).filter(Boolean);
    const payload = { ...form, features: JSON.stringify(featuresArray) };
    try {
      if (editId) {
        await updatePlan(editId, payload);
        setSuccess('Plan updated successfully');
      } else {
        await createPlan(payload);
        setSuccess('Plan created successfully');
      }
      setShowModal(false);
      fetchPlans();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deletePlan(id);
      setDeleteConfirm(null);
      setSuccess('Plan deleted');
      fetchPlans();
    } catch (err) {
      setError('Failed to delete plan');
    }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title"><Package size={24} /> Subscription Plans</h1>
          <p className="page-subtitle">Manage pricing plans and features displayed on the public pricing page</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Add Plan</button>
      </div>

      {/* Pricing Visibility Toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', marginBottom: '20px', borderRadius: '10px',
        background: showPricing
          ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.04))'
          : 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(220,38,38,0.04))',
        border: `1px solid ${showPricing ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {showPricing
            ? <Eye size={20} style={{ color: 'var(--success)' }} />
            : <EyeOff size={20} style={{ color: 'var(--danger)' }} />
          }
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
              Pricing Section on Landing Page
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {showPricing
                ? 'Pricing plans and "Get Started" buttons are visible to visitors'
                : 'Pricing is hidden. Visitors see "Get Started" linking to login page'}
            </div>
          </div>
        </div>
        <button
          className={`btn btn-sm ${showPricing ? 'btn-outline danger' : 'btn-primary'}`}
          onClick={togglePricing}
          disabled={togglingPricing}
          style={{ minWidth: '120px' }}
        >
          {togglingPricing
            ? <><RefreshCw size={14} className="spinning" /> Updating...</>
            : showPricing ? <><EyeOff size={14} /> Hide Pricing</> : <><Eye size={14} /> Show Pricing</>
          }
        </button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {error && !showModal && <div className="alert alert-danger"><AlertTriangle size={16} /> {error}</div>}

      {plans.length === 0 ? (
        <div className="empty-state">
          <Package size={48} />
          <h3>No Plans Created</h3>
          <p>Create subscription plans that will appear on the public pricing page.</p>
          <button className="btn btn-primary mt-4" onClick={openCreate}><Plus size={16} /> Add Plan</button>
        </div>
      ) : (
        <div className="plans-grid">
          {plans.map((plan) => {
            const features = parseFeatures(plan.features);
            return (
              <div key={plan.id} className={`plan-card ${plan.is_popular ? 'popular' : ''} ${!plan.is_active ? 'inactive' : ''}`}>
                <div className="plan-card-top">
                  <div className="plan-card-header">
                    <div>
                      <h3>{plan.name}</h3>
                      <span className="plan-slug">/{plan.slug}</span>
                    </div>
                    <div className="plan-badges">
                      {plan.is_popular && <span className="badge badge-primary"><Star size={10} /> Popular</span>}
                      {plan.badge_text && <span className="badge badge-info">{plan.badge_text}</span>}
                      <span className={`badge ${plan.is_active ? 'badge-success' : 'badge-danger'}`}>
                        {plan.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  {plan.description && <p className="plan-desc">{plan.description}</p>}

                  <div className="plan-pricing">
                    <div className="plan-price-item">
                      <DollarSign size={14} />
                      <strong>{plan.price_monthly === 0 ? 'Free' : `${plan.price_monthly}`}</strong>
                      <span>/month</span>
                    </div>
                    <div className="plan-price-item">
                      <DollarSign size={14} />
                      <strong>{plan.price_yearly === 0 ? 'Free' : `${plan.price_yearly}`}</strong>
                      <span>/year</span>
                    </div>
                    <div className="plan-price-item">
                      <span>Currency:</span> <strong>{plan.currency}</strong>
                    </div>
                  </div>

                  <div className="plan-limits">
                    <span className="method-tag">
                      {plan.max_assessments === 0 ? 'Unlimited' : plan.max_assessments} Assessments
                    </span>
                    <span className="method-tag">
                      {plan.max_hcps === 0 ? 'Unlimited' : plan.max_hcps} HCPs
                    </span>
                    <span className="method-tag">Order: {plan.sort_order}</span>
                  </div>
                </div>

                {features.length > 0 && (
                  <div className="plan-features">
                    <strong>Features:</strong>
                    <ul>
                      {features.map((f, i) => (
                        <li key={i}><Check size={14} className="text-success" /> {f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="config-card-actions">
                  <button className="btn btn-sm btn-outline" onClick={() => openEdit(plan)}>
                    <Edit2 size={14} /> Edit
                  </button>
                  <button className="btn btn-sm btn-outline danger" onClick={() => setDeleteConfirm(plan.id)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Plan' : 'Create New Plan'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger mb-4"><AlertTriangle size={14} /> {error}</div>}

              <div className="form-row">
                <div className="form-group">
                  <label>Plan Name *</label>
                  <input className="form-control" value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm({ ...form, name, slug: editId ? form.slug : generateSlug(name) });
                    }}
                    placeholder="e.g. Professional" />
                </div>
                <div className="form-group">
                  <label>Slug *</label>
                  <input className="form-control" value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="professional" />
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input className="form-control" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Short description for the pricing card" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Monthly Price ($)</label>
                  <input className="form-control" type="number" min="0" step="0.01" value={form.price_monthly}
                    onChange={(e) => setForm({ ...form, price_monthly: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="form-group">
                  <label>Yearly Price ($)</label>
                  <input className="form-control" type="number" min="0" step="0.01" value={form.price_yearly}
                    onChange={(e) => setForm({ ...form, price_yearly: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select className="form-control" value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                    {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'AUD', 'CAD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Max Assessments (0 = unlimited)</label>
                  <input className="form-control" type="number" min="0" value={form.max_assessments}
                    onChange={(e) => setForm({ ...form, max_assessments: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="form-group">
                  <label>Max HCPs (0 = unlimited)</label>
                  <input className="form-control" type="number" min="0" value={form.max_hcps}
                    onChange={(e) => setForm({ ...form, max_hcps: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="form-group">
                  <label>Sort Order</label>
                  <input className="form-control" type="number" min="0" value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
                </div>
              </div>

              <div className="form-group">
                <label>Features (one per line)</label>
                <textarea className="form-control" rows={6} value={featureLines}
                  onChange={(e) => setFeatureLines(e.target.value)}
                  placeholder={"5 Assessments/month\n10 HCP Profiles\nBasic Scoring (C.1-C.4)\nCSV Export\nEmail Support"} />
              </div>

              <div className="form-group">
                <label>Badge Text (optional)</label>
                <input className="form-control" value={form.badge_text}
                  onChange={(e) => setForm({ ...form, badge_text: e.target.value })}
                  placeholder="e.g. Most Popular, Best Value" />
              </div>

              <div className="form-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  <span>Active (visible on pricing page)</span>
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_popular}
                    onChange={(e) => setForm({ ...form, is_popular: e.target.checked })} />
                  <span>Mark as Popular (highlighted card)</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : editId ? 'Update Plan' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog">
              <div className="confirm-icon"><AlertTriangle size={24} /></div>
              <h3>Delete Plan?</h3>
              <p>This will permanently remove this subscription plan. Active subscribers will not be affected.</p>
              <div className="confirm-actions">
                <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
