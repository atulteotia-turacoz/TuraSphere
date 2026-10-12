import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { login } from '../services/api';
import ThemeToggle from '../components/common/ThemeToggle';
import Wordmark from '../components/common/Wordmark';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
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
      const res = await login(form);
      localStorage.setItem('token', res.data.access_token);
      if (res.data.user) {
        localStorage.setItem('user', JSON.stringify(res.data.user));
      }
      navigate('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.detail || err.response?.data?.message || 'Invalid credentials. Please try again.';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <ThemeToggle className="theme-toggle-floating" />
      <div className="auth-card">
        <Link to="/" className="auth-brand" style={{ textDecoration: 'none' }}>
          {<Wordmark />}
        </Link>
        <h2>Welcome Back</h2>
        <p className="auth-subtitle">Sign in to your account to continue</p>

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Enter your password"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <><span className="spinner spinner-sm"></span> Signing In...</> : 'Sign In'}
          </button>
        </form>

        {/* <div className="auth-footer">
          Don't have an account? <Link to="/register">Create one</Link>
        </div> */}
      </div>
    </div>
  );
}
