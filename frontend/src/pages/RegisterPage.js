import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { register, login } from '../services/api';
import ThemeToggle from '../components/common/ThemeToggle';
import Wordmark from '../components/common/Wordmark';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planSlug = searchParams.get('plan');
  const planId = searchParams.get('plan_id');
  const cycle = searchParams.get('cycle') || 'monthly';
  const servicesParam = searchParams.get('services');

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    organization: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const regData = { ...form };
      if (servicesParam) {
        regData.allowed_services = servicesParam.split(',');
      }
      await register(regData);
      // Auto-login after registration
      const loginRes = await login({ email: form.email, password: form.password });
      const token = loginRes.data.access_token || loginRes.data.token;
      if (token) {
        localStorage.setItem('token', token);
        // If a plan was selected from pricing, go to checkout
        if (planId) {
          navigate(`/checkout?plan_id=${planId}&cycle=${cycle}`);
        } else {
          navigate('/dashboard');
        }
      } else {
        navigate('/login');
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.response?.data?.message || 'Registration failed. Please try again.';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <ThemeToggle className="theme-toggle-floating" />
      <div className="auth-card">
        <div className="auth-brand">
          {<Wordmark />}
        </div>
        <h2>Create Account</h2>
        <p className="auth-subtitle">
          {planSlug
            ? `Sign up to subscribe to the ${planSlug.charAt(0).toUpperCase() + planSlug.slice(1)} plan`
            : 'Get started with KOL assessments'}
        </p>

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="full_name">Full Name</label>
            <input
              id="full_name"
              type="text"
              name="full_name"
              value={form.full_name}
              onChange={handleChange}
              placeholder="John Doe"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-email">Email Address</label>
            <input
              id="reg-email"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Create a strong password"
              required
              minLength={6}
            />
          </div>

          <div className="form-group">
            <label htmlFor="organization">Organization</label>
            <input
              id="organization"
              type="text"
              name="organization"
              value={form.organization}
              onChange={handleChange}
              placeholder="Your company or institution"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <><span className="spinner spinner-sm"></span> Creating Account...</> : 'Create Account'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
