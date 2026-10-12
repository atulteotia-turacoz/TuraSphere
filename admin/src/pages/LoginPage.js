import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../services/api';
import ThemeToggle from '../components/ThemeToggle';
import Wordmark from '../components/Wordmark';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const user = JSON.parse(localStorage.getItem('admin_user') || 'null');
    if (
      token &&
      user &&
      (user.role === 'admin' || user.role === 'super_admin')
    ) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login(email, password);
      const { access_token, user } = res.data;

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        setError('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }

      localStorage.setItem('admin_token', access_token);
      localStorage.setItem('admin_user', JSON.stringify(user));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg =
        err.response?.data?.detail || 'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <ThemeToggle className="theme-toggle-floating" />
      <div className="login-card">
        <div className="login-brand">
          <h1><Wordmark suffix="Admin" /></h1>
          <p>Admin Portal</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              className="form-control"
              placeholder="admin@tura.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-control"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
