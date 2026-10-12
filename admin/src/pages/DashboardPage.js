import React, { useState, useEffect } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Users, UserCheck, ClipboardCheck, TrendingUp, FileText, CreditCard, Clock, Activity } from 'lucide-react';
import { getAdminDashboard } from '../services/api';

const TIER_COLORS = {
  GLOBAL_KOL: 'var(--tier-platinum)',
  STRATEGIC_KOL: 'var(--info)',
  NATIONAL_KOL: 'var(--tier-bronze)',
  EMERGING_KOL: 'var(--success)',
  LOCAL_KOL: 'var(--warning)',
  NON_KOL: 'var(--text-secondary)',
};

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await getAdminDashboard();
      setData(res.data);
    } catch (err) {
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return <div className="login-error">{error}</div>;
  }

  const stats = data || {};
  const tierDistribution = stats.tier_distribution
    ? Object.entries(stats.tier_distribution).map(([name, value]) => ({
        name: name.replace(/_/g, ' '),
        key: name,
        value,
      }))
    : [];

  const recentAssessments = stats.recent_assessments || [];
  const byDay = stats.assessments_by_day || [];
  // Guard the divisor: an all-zero series would otherwise divide by zero.
  const dayMax = Math.max(1, ...byDay.map((d) => d.count || 0));
  const topSpecialties = stats.top_specialties || [];
  const specMax = Math.max(1, ...topSpecialties.map((t) => t.count || 0));
  const recentActivity = stats.recent_activity || [];

  return (
    <div>
      {/* Stat Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <h4>Total Users</h4>
            <div className="stat-value">{stats.total_users ?? 0}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <UserCheck size={24} />
          </div>
          <div className="stat-info">
            <h4>Total HCPs</h4>
            <div className="stat-value">{stats.total_hcps ?? 0}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">
            <ClipboardCheck size={24} />
          </div>
          <div className="stat-info">
            <h4>Total Assessments</h4>
            <div className="stat-value">{stats.total_assessments ?? 0}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon amber">
            <TrendingUp size={24} />
          </div>
          <div className="stat-info">
            <h4>Avg Score</h4>
            <div className="stat-value">
              {stats.avg_score != null
                ? Number(stats.avg_score).toFixed(1)
                : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Second band — figures the endpoint already returned but nothing showed. */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon green">
            <ClipboardCheck size={24} />
          </div>
          <div className="stat-info">
            <h4>Assessed HCPs</h4>
            <div className="stat-value">{stats.assessed_hcps ?? 0}</div>
            <div className="stat-sub">
              {stats.completion_rate != null ? `${stats.completion_rate}% of book` : '--'}
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">
            <FileText size={24} />
          </div>
          <div className="stat-info">
            <h4>CVs on File</h4>
            <div className="stat-value">{stats.hcps_with_cv ?? 0}</div>
            <div className="stat-sub">document-backed profiles</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <h4>New Users (7d)</h4>
            <div className="stat-value">{stats.new_users_this_week ?? 0}</div>
            <div className="stat-sub">
              {Object.entries(stats.users_by_role || {})
                .map(([role, n]) => `${n} ${role.replace(/_/g, ' ')}`)
                .join(' · ') || 'no users yet'}
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon amber">
            <CreditCard size={24} />
          </div>
          <div className="stat-info">
            <h4>Active Subscriptions</h4>
            <div className="stat-value">{stats.active_subscriptions ?? 0}</div>
            <div className="stat-sub">currently billing</div>
          </div>
        </div>
      </div>

      {/* Charts & Tables */}
      <div className="dashboard-grid">
        {/* Tier Distribution Pie Chart */}
        <div className="chart-container">
          <h3>Tier Distribution</h3>
          <div className="chart-wrapper">
            {tierDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={tierDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {tierDistribution.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={TIER_COLORS[entry.key] || 'var(--text-muted)'}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted">No assessment data yet</p>
            )}
          </div>
        </div>

        {/* Activity Summary */}
        <div className="chart-container">
          <h3>Activity Summary</h3>
          <div style={{ padding: '16px 0' }}>
            <div className="detail-grid">
              <div className="detail-item">
                <label>Assessments Today</label>
                <div className="detail-value">
                  {stats.assessments_today ?? 0}
                </div>
              </div>
              <div className="detail-item">
                <label>Assessments This Week</label>
                <div className="detail-value">
                  {stats.assessments_this_week ?? 0}
                </div>
              </div>
              <div className="detail-item">
                <label>Active Users</label>
                <div className="detail-value">
                  {stats.active_users ?? 0}
                </div>
              </div>
              <div className="detail-item">
                <label>Pending Reviews</label>
                <div className="detail-value">
                  {stats.pending_reviews ?? 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Assessment volume, last 14 days. A bar per day, zero days included —
            a series with gaps reads as missing data rather than a quiet day. */}
        <div className="chart-container full-width">
          <h3>Assessment Volume · Last 14 Days</h3>
          {dayMax > 0 ? (
            <div className="volume-chart">
              {byDay.map((d) => (
                <div className="volume-col" key={d.date} title={`${d.date}: ${d.count}`}>
                  <div className="volume-bar-track">
                    <div
                      className="volume-bar"
                      style={{ height: `${Math.round((d.count / dayMax) * 100)}%` }}
                    />
                  </div>
                  <span className="volume-count">{d.count}</span>
                  <span className="volume-day">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No assessments in the last 14 days</p>
          )}
        </div>

        {/* Where the HCP book is concentrated */}
        <div className="chart-container">
          <h3>Top Specialties</h3>
          {topSpecialties.length > 0 ? (
            <div className="rank-list">
              {topSpecialties.map((t) => (
                <div className="rank-row" key={t.specialty}>
                  <span className="rank-label">{t.specialty}</span>
                  <span className="rank-track">
                    <span
                      className="rank-fill"
                      style={{ width: `${Math.round((t.count / specMax) * 100)}%` }}
                    />
                  </span>
                  <span className="rank-count">{t.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No specialties recorded yet</p>
          )}
        </div>

        {/* Audit trail */}
        <div className="chart-container">
          <h3>Recent Activity</h3>
          {recentActivity.length > 0 ? (
            <div className="activity-list">
              {recentActivity.map((a) => (
                <div className="activity-row" key={a.id}>
                  <span className="activity-icon"><Activity size={14} /></span>
                  <span className="activity-body">
                    <span className="activity-action">{a.action}</span>
                    {a.details && <span className="activity-details">{a.details}</span>}
                  </span>
                  <span className="activity-time">
                    <Clock size={12} />
                    {a.created_at ? new Date(a.created_at).toLocaleString() : '--'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No activity logged yet</p>
          )}
        </div>

        {/* Recent Assessments */}
        <div className="table-container full-width">
          <div className="table-header">
            <h3>Recent Assessments</h3>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>HCP Name</th>
                  <th>Specialty</th>
                  <th>Final Score</th>
                  <th>Tier</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentAssessments.length > 0 ? (
                  recentAssessments.map((a, i) => (
                    <tr key={a.id || i}>
                      <td>{a.hcp_name || '--'}</td>
                      <td>{a.specialty || '--'}</td>
                      <td>
                        <strong>
                          {a.final_score != null
                            ? Number(a.final_score).toFixed(1)
                            : '--'}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`badge badge-tier-${(
                            a.tier || ''
                          ).toLowerCase()}`}
                        >
                          {a.tier || '--'}
                        </span>
                      </td>
                      <td>
                        {a.created_at
                          ? new Date(a.created_at).toLocaleDateString()
                          : '--'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      <p>No recent assessments</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
