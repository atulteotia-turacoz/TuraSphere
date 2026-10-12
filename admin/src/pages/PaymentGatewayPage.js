import React, { useState, useEffect } from 'react';
import {
  CreditCard, Plus, Edit2, Trash2, X, Check, AlertTriangle,
  Star, TestTube, Eye, EyeOff, RefreshCw, Shield, Globe,
} from 'lucide-react';
import {
  listPaymentGateways, createPaymentGateway, updatePaymentGateway,
  deletePaymentGateway, testPaymentGateway, setDefaultPayment,
} from '../services/api';

const PAYMENT_PROVIDERS = [
  { value: 'razorpay', label: 'Razorpay', currencies: ['INR', 'USD'], methods: ['card', 'upi', 'netbanking', 'wallet'] },
  { value: 'stripe', label: 'Stripe', currencies: ['USD', 'EUR', 'GBP', 'INR'], methods: ['card', 'bank_transfer', 'wallet'] },
  { value: 'ccavenue', label: 'CCAvenue', currencies: ['INR'], methods: ['card', 'netbanking', 'upi', 'wallet', 'emi'] },
  { value: 'paypal', label: 'PayPal', currencies: ['USD', 'EUR', 'GBP'], methods: ['paypal', 'card'] },
  { value: 'payu', label: 'PayU', currencies: ['INR', 'USD'], methods: ['card', 'netbanking', 'upi', 'wallet'] },
  { value: 'cashfree', label: 'Cashfree', currencies: ['INR'], methods: ['card', 'upi', 'netbanking', 'wallet'] },
  { value: 'phonepe', label: 'PhonePe PG', currencies: ['INR'], methods: ['upi', 'card', 'netbanking'] },
  { value: 'custom', label: 'Custom Gateway', currencies: [], methods: [] },
];

const emptyForm = {
  provider: 'razorpay', display_name: '', api_key: '', api_secret: '',
  merchant_id: '', webhook_url: '', is_live: false, is_active: true,
  is_default: false, supported_currencies: 'INR', description: '', supported_methods: '',
};

export default function PaymentGatewayPage() {
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showSecrets, setShowSecrets] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [selectedMethods, setSelectedMethods] = useState([]);

  const fetchGateways = async () => {
    try {
      const res = await listPaymentGateways();
      setGateways(res.data);
    } catch (err) {
      setError('Failed to load payment gateways');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGateways(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setSelectedMethods([]);
    setError('');
    setShowModal(true);
  };

  const openEdit = (gw) => {
    setEditId(gw.id);
    setForm({
      provider: gw.provider, display_name: gw.display_name,
      api_key: gw.api_key || '', api_secret: gw.api_secret || '',
      merchant_id: gw.merchant_id || '', webhook_url: gw.webhook_url || '',
      is_live: gw.is_live || false, is_active: gw.is_active, is_default: gw.is_default,
      supported_currencies: gw.supported_currencies || 'USD', description: gw.description || '',
      supported_methods: gw.supported_methods || '',
    });
    try { setSelectedMethods(JSON.parse(gw.supported_methods || '[]')); } catch { setSelectedMethods([]); }
    setError('');
    setShowModal(true);
  };

  const toggleMethod = (method) => {
    setSelectedMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const handleSave = async () => {
    if (!form.display_name.trim()) { setError('Display name is required'); return; }
    setSaving(true);
    setError('');
    const payload = { ...form, supported_methods: JSON.stringify(selectedMethods) };
    try {
      if (editId) {
        await updatePaymentGateway(editId, payload);
        setSuccess('Payment gateway updated successfully');
      } else {
        await createPaymentGateway(payload);
        setSuccess('Payment gateway created successfully');
      }
      setShowModal(false);
      fetchGateways();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deletePaymentGateway(id);
      setDeleteConfirm(null);
      setSuccess('Payment gateway deleted');
      fetchGateways();
    } catch (err) {
      setError('Failed to delete');
    }
  };

  const handleTest = async (id) => {
    setTestResult(null);
    try {
      const res = await testPaymentGateway(id);
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ success: false, message: 'Connection test failed' });
    }
    setTimeout(() => setTestResult(null), 4000);
  };

  const handleSetDefault = async (id) => {
    try {
      await setDefaultPayment(id);
      setSuccess('Default payment gateway updated');
      fetchGateways();
    } catch (err) {
      setError('Failed to set default');
    }
  };

  const toggleSecret = (id, field) => {
    const key = `${id}_${field}`;
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const maskSecret = (val) => val ? val.slice(0, 6) + '••••••••' + val.slice(-4) : '—';

  const selectedProvider = PAYMENT_PROVIDERS.find((p) => p.value === form.provider);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const parseMethods = (methodsStr) => {
    try { return JSON.parse(methodsStr || '[]'); } catch { return []; }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title"><CreditCard size={24} /> Payment Gateways</h1>
          <p className="page-subtitle">Manage payment gateway integrations for subscription billing</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Add Gateway</button>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}
      {testResult && (
        <div className={`alert ${testResult.success ? 'alert-success' : 'alert-danger'}`}>
          <TestTube size={16} /> {testResult.message}
        </div>
      )}

      {gateways.length === 0 ? (
        <div className="empty-state">
          <CreditCard size={48} />
          <h3>No Payment Gateways Configured</h3>
          <p>Add a payment gateway to enable subscription billing for your clients.</p>
          <button className="btn btn-primary mt-4" onClick={openCreate}><Plus size={16} /> Add Gateway</button>
        </div>
      ) : (
        <div className="config-grid">
          {gateways.map((gw) => (
            <div key={gw.id} className={`config-card ${gw.is_active ? '' : 'inactive'} ${gw.is_default ? 'default' : ''}`}>
              <div className="config-card-header">
                <div className="config-provider-info">
                  <div className={`config-provider-icon payment ${gw.provider}`}>
                    <CreditCard size={18} />
                  </div>
                  <div>
                    <h3>{gw.display_name}</h3>
                    <span className="config-provider-label">{gw.provider.toUpperCase()}</span>
                  </div>
                </div>
                <div className="config-badges">
                  {gw.is_default && <span className="badge badge-primary"><Star size={10} /> Default</span>}
                  <span className={`badge ${gw.is_live ? 'badge-success' : 'badge-warning'}`}>
                    {gw.is_live ? <Globe size={10} /> : <Shield size={10} />}
                    {' '}{gw.is_live ? 'LIVE' : 'TEST'}
                  </span>
                  <span className={`badge ${gw.is_active ? 'badge-success' : 'badge-danger'}`}>
                    {gw.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="config-card-body">
                <div className="config-detail-row">
                  <span className="config-label">API Key</span>
                  <span className="config-value mono">
                    {showSecrets[`${gw.id}_key`] ? gw.api_key : maskSecret(gw.api_key)}
                    <button className="btn-icon-xs" onClick={() => toggleSecret(gw.id, 'key')}>
                      {showSecrets[`${gw.id}_key`] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </span>
                </div>
                <div className="config-detail-row">
                  <span className="config-label">Currencies</span>
                  <span className="config-value">{gw.supported_currencies || '—'}</span>
                </div>
                {gw.merchant_id && (
                  <div className="config-detail-row">
                    <span className="config-label">Merchant ID</span>
                    <span className="config-value mono">{gw.merchant_id}</span>
                  </div>
                )}
                {gw.supported_methods && (
                  <div className="config-detail-row">
                    <span className="config-label">Methods</span>
                    <span className="config-value">
                      {parseMethods(gw.supported_methods).map((m) => (
                        <span key={m} className="method-tag">{m}</span>
                      ))}
                    </span>
                  </div>
                )}
                {gw.description && (
                  <div className="config-detail-row">
                    <span className="config-label">Notes</span>
                    <span className="config-value">{gw.description}</span>
                  </div>
                )}
              </div>

              <div className="config-card-actions">
                <button className="btn btn-sm btn-outline" onClick={() => handleTest(gw.id)}><TestTube size={14} /> Test</button>
                {!gw.is_default && (
                  <button className="btn btn-sm btn-outline" onClick={() => handleSetDefault(gw.id)}><Star size={14} /> Set Default</button>
                )}
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(gw)}><Edit2 size={14} /> Edit</button>
                <button className="btn btn-sm btn-outline danger" onClick={() => setDeleteConfirm(gw.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Payment Gateway' : 'Add Payment Gateway'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger mb-4"><AlertTriangle size={14} /> {error}</div>}

              <div className="form-row">
                <div className="form-group">
                  <label>Provider *</label>
                  <select className="form-control" value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value, supported_currencies: PAYMENT_PROVIDERS.find(p=>p.value===e.target.value)?.currencies[0] || 'USD' })}>
                    {PAYMENT_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Display Name *</label>
                  <input className="form-control" value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    placeholder="e.g. Razorpay Production" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>API Key / Key ID</label>
                  <input className="form-control" type="password" value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder="Enter API key" />
                </div>
                <div className="form-group">
                  <label>API Secret / Secret Key</label>
                  <input className="form-control" type="password" value={form.api_secret}
                    onChange={(e) => setForm({ ...form, api_secret: e.target.value })}
                    placeholder="Enter API secret" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Merchant ID (if applicable)</label>
                  <input className="form-control" value={form.merchant_id}
                    onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}
                    placeholder="Merchant ID" />
                </div>
                <div className="form-group">
                  <label>Webhook URL</label>
                  <input className="form-control" value={form.webhook_url}
                    onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                    placeholder="https://your-domain.com/webhook" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mode</label>
                  <select className="form-control" value={form.is_live ? 'live' : 'test'}
                    onChange={(e) => setForm({ ...form, is_live: e.target.value === 'live' })}>
                    <option value="test">Test / Sandbox</option>
                    <option value="live">Live / Production</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Supported Currencies</label>
                  <select className="form-control" value={form.supported_currencies}
                    onChange={(e) => setForm({ ...form, supported_currencies: e.target.value })}>
                    {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedProvider && selectedProvider.methods.length > 0 && (
                <div className="form-group">
                  <label>Supported Payment Methods</label>
                  <div className="method-checkboxes">
                    {selectedProvider.methods.map((m) => (
                      <label key={m} className="checkbox-label">
                        <input type="checkbox" checked={selectedMethods.includes(m)}
                          onChange={() => toggleMethod(m)} />
                        <span>{m.replace('_', ' ').toUpperCase()}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Description / Notes</label>
                <textarea className="form-control" rows={2} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Internal notes" />
              </div>

              <div className="form-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  <span>Active</span>
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                  <span>Set as Default Gateway</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><RefreshCw size={14} className="spinning" /> Saving...</> : editId ? 'Update' : 'Create'}
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
              <h3>Delete Gateway?</h3>
              <p>This will permanently remove the payment gateway configuration. Active subscriptions may be affected.</p>
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
