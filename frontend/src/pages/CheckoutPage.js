import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CreditCard, Check, AlertTriangle, Shield, Lock, ArrowRight, Package,
} from 'lucide-react';
import {
  getPlans, getBilling, updateBilling, subscribe,
  getActivePaymentGateway, createOrder, verifyPayment,
} from '../services/api';

// Load Razorpay script dynamically
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (document.getElementById('razorpay-script')) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.id = 'razorpay-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planId = parseInt(searchParams.get('plan_id'));
  const cycle = searchParams.get('cycle') || 'monthly';

  const [plan, setPlan] = useState(null);
  const [gateway, setGateway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1: billing, 2: payment, 3: success

  const [billingForm, setBillingForm] = useState({
    company_name: '', address_line1: '', address_line2: '',
    city: '', state: '', zip_code: '', country: '', tax_id: '', phone: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [planRes, billRes, gwRes] = await Promise.all([
          getPlans(), getBilling(), getActivePaymentGateway(),
        ]);
        const selectedPlan = planRes.data.find((p) => p.id === planId);
        if (selectedPlan) setPlan(selectedPlan);
        if (billRes.data) {
          setBillingForm({
            company_name: billRes.data.company_name || '',
            address_line1: billRes.data.address_line1 || '',
            address_line2: billRes.data.address_line2 || '',
            city: billRes.data.city || '', state: billRes.data.state || '',
            zip_code: billRes.data.zip_code || '', country: billRes.data.country || '',
            tax_id: billRes.data.tax_id || '', phone: billRes.data.phone || '',
          });
        }
        if (gwRes.data) setGateway(gwRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [planId]);

  const price = plan
    ? cycle === 'yearly' ? plan.price_yearly : plan.price_monthly
    : 0;

  const parseFeatures = (f) => {
    try { return JSON.parse(f || '[]'); } catch { return []; }
  };

  const currencySymbols = { USD: '$', INR: '₹', EUR: '€', GBP: '£' };
  const curr = plan?.currency || 'USD';
  const sym = currencySymbols[curr.toUpperCase()] || curr + ' ';

  const handleBillingNext = async () => {
    setError('');
    try {
      await updateBilling(billingForm);
      if (price === 0) {
        // Free plan — subscribe directly, no payment needed
        setProcessing(true);
        try {
          await subscribe({ plan_id: plan.id, billing_cycle: cycle });
          setStep(3);
        } catch (err) {
          setError(err.response?.data?.detail || 'Subscription failed.');
        } finally {
          setProcessing(false);
        }
      } else {
        setStep(2);
      }
    } catch (err) {
      setError('Failed to save billing details');
    }
  };

  const handlePayment = async () => {
    setProcessing(true);
    setError('');

    try {
      // 1. Create Razorpay order on backend
      const orderRes = await createOrder({ plan_id: plan.id, billing_cycle: cycle });
      const { order_id, amount, currency, key_id, user_email, user_name } = orderRes.data;

      // 2. Load Razorpay SDK
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        setError('Failed to load payment gateway. Please check your internet connection.');
        setProcessing(false);
        return;
      }

      // 3. Open Razorpay checkout popup
      const options = {
        key: key_id,
        amount: amount,
        currency: currency,
        name: 'TuraSphere',
        description: `${plan.name} Plan (${cycle})`,
        order_id: order_id,
        prefill: {
          name: user_name,
          email: user_email,
        },
        theme: {
          color: 'var(--color-primary)',
        },
        handler: async function (response) {
          // 4. Payment successful — verify on backend
          try {
            await verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan_id: plan.id,
              billing_cycle: cycle,
            });
            setStep(3);
          } catch (err) {
            setError(err.response?.data?.detail || 'Payment verification failed.');
          } finally {
            setProcessing(false);
          }
        },
        modal: {
          ondismiss: function () {
            setProcessing(false);
          },
        },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', function (response) {
        setError(`Payment failed: ${response.error.description}`);
        setProcessing(false);
      });
      razorpay.open();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to initiate payment. Please try again.');
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-spinner"><div className="spinner" /></div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="page container">
        <div className="checkout-empty">
          <Package size={48} />
          <h2>No plan selected</h2>
          <p>Please choose a plan from our pricing page.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>View Plans</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page container">
      <div className="checkout-wrapper">
        {/* Steps indicator */}
        <div className="checkout-steps">
          <div className={`checkout-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'done' : ''}`}>
            <div className="checkout-step-num">{step > 1 ? <Check size={16} /> : '1'}</div>
            <span>Billing Details</span>
          </div>
          <div className="checkout-step-line" />
          {price > 0 && (
            <>
              <div className={`checkout-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'done' : ''}`}>
                <div className="checkout-step-num">{step > 2 ? <Check size={16} /> : '2'}</div>
                <span>Payment</span>
              </div>
              <div className="checkout-step-line" />
            </>
          )}
          <div className={`checkout-step ${step >= 3 ? 'active' : ''}`}>
            <div className="checkout-step-num">{step >= 3 ? <Check size={16} /> : price > 0 ? '3' : '2'}</div>
            <span>Confirmation</span>
          </div>
        </div>

        <div className="checkout-layout">
          {/* Left: Form */}
          <div className="checkout-form-section">
            {error && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}

            {/* Step 1: Billing */}
            {step === 1 && (
              <div className="checkout-card">
                <h3><CreditCard size={20} /> Billing Information</h3>
                <p className="checkout-hint">These details will appear on your invoice.</p>
                <div className="form-group">
                  <label>Company / Organization Name</label>
                  <input className="form-control" value={billingForm.company_name}
                    onChange={(e) => setBillingForm({ ...billingForm, company_name: e.target.value })}
                    placeholder="Acme Corp" />
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
                    <label>Tax ID / GST</label>
                    <input className="form-control" value={billingForm.tax_id}
                      onChange={(e) => setBillingForm({ ...billingForm, tax_id: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input className="form-control" value={billingForm.phone}
                      onChange={(e) => setBillingForm({ ...billingForm, phone: e.target.value })} />
                  </div>
                </div>
                <button className="btn btn-primary btn-block" onClick={handleBillingNext} disabled={processing}>
                  {price === 0
                    ? (processing ? 'Activating...' : 'Complete Subscription')
                    : 'Continue to Payment'} <ArrowRight size={16} />
                </button>
              </div>
            )}

            {/* Step 2: Payment */}
            {step === 2 && (
              <div className="checkout-card">
                <h3><Lock size={20} /> Payment</h3>

                {gateway && (
                  <div className="checkout-gateway-info">
                    <div className="checkout-gateway-badge">
                      <Shield size={16} />
                      <span>Payment via <strong>{gateway.display_name || gateway.provider}</strong></span>
                    </div>
                    {gateway.supported_methods && (
                      <p className="checkout-hint" style={{ marginTop: 8 }}>
                        Supported methods: {gateway.supported_methods}
                      </p>
                    )}
                    <p className="checkout-hint" style={{ marginTop: 4 }}>
                      Mode: {gateway.is_live ? 'Live' : 'Test / Sandbox'}
                    </p>
                  </div>
                )}

                <div className="checkout-payment-summary">
                  <div className="checkout-total-row total">
                    <span>Amount to pay</span>
                    <span>{sym}{price.toFixed(2)}</span>
                  </div>
                </div>

                <div className="checkout-secure-note">
                  <Shield size={14} /> Secured by 256-bit SSL encryption
                </div>

                <button
                  className="btn btn-primary btn-block"
                  onClick={handlePayment}
                  disabled={processing}
                >
                  {processing
                    ? 'Processing...'
                    : `Pay with ${gateway?.display_name || gateway?.provider || 'Razorpay'} — ${sym}${price.toFixed(2)}`}
                </button>
                <button
                  className="btn btn-ghost btn-block"
                  onClick={() => setStep(1)}
                  style={{ marginTop: 8 }}
                  disabled={processing}
                >
                  Back to Billing
                </button>
              </div>
            )}

            {/* Step 3: Success */}
            {step === 3 && (
              <div className="checkout-card checkout-success">
                <div className="checkout-success-icon">
                  <Check size={40} />
                </div>
                <h2>Subscription Activated!</h2>
                <p>You are now subscribed to the <strong>{plan.name}</strong> plan ({cycle}).</p>
                <p className="checkout-hint">An invoice has been generated and is available in your account.</p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
                  <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
                    Go to Dashboard <ArrowRight size={16} />
                  </button>
                  <button className="btn btn-outline" onClick={() => navigate('/account')}>
                    View Invoice
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Order Summary */}
          {step < 3 && (
            <div className="checkout-summary">
              <div className="checkout-summary-card">
                <h4>Order Summary</h4>
                <div className="checkout-plan-name">{plan.name}</div>
                <div className="checkout-plan-cycle">{cycle === 'yearly' ? 'Annual' : 'Monthly'} billing</div>

                <div className="checkout-summary-divider" />

                <ul className="checkout-plan-features">
                  {parseFeatures(plan.features).map((f, i) => (
                    <li key={i}><Check size={13} /> {f}</li>
                  ))}
                </ul>

                <div className="checkout-summary-divider" />

                <div className="checkout-total-row">
                  <span>Subtotal</span>
                  <span>{sym}{price.toFixed(2)}</span>
                </div>
                <div className="checkout-total-row">
                  <span>Tax</span>
                  <span>{sym}0.00</span>
                </div>
                <div className="checkout-summary-divider" />
                <div className="checkout-total-row total">
                  <span>Total</span>
                  <span>{sym}{price.toFixed(2)} / {cycle === 'yearly' ? 'year' : 'month'}</span>
                </div>

                {gateway && (
                  <div className="checkout-gateway-note">
                    Payment processed by {gateway.display_name || gateway.provider}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
