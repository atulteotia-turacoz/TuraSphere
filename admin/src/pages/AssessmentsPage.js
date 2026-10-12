import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, AlertTriangle, Check } from 'lucide-react';
import { listAllAssessments, deleteAssessment } from '../services/api';

const TIERS = ['All', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Rising'];

export default function AssessmentsPage() {
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const fetchAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (tierFilter !== 'All') params.tier = tierFilter;
      if (search) params.search = search;

      const res = await listAllAssessments(params);
      const data = res.data;
      setAssessments(data?.assessments || data || []);
      setTotalPages(data?.total_pages || 1);
    } catch (err) {
      console.error('Failed to fetch assessments', err);
    } finally {
      setLoading(false);
    }
  }, [page, tierFilter, search]);

  useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const handleRowClick = (id) => {
    navigate(`/assessments/${id}`);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await deleteAssessment(id);
      setSuccess('Assessment deleted successfully');
      setDeleteConfirm(null);
      fetchAssessments();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete assessment');
      setDeleteConfirm(null);
    }
  };

  return (
    <div>
      <div className="table-container">
        <div className="table-header">
          <h3>All Assessments</h3>
          <div className="table-actions">
            <div className="table-search">
              <Search className="search-icon" size={16} />
              <input
                type="text"
                placeholder="Search by HCP name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="filter-bar">
              <select
                value={tierFilter}
                onChange={(e) => {
                  setTierFilter(e.target.value);
                  setPage(1);
                }}
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t === 'All' ? 'All Tiers' : t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {success && <div className="alert alert-success" style={{ margin: '0 16px 12px' }}><Check size={16} /> {success}</div>}
        {error && <div className="alert alert-error" style={{ margin: '0 16px 12px' }}><AlertTriangle size={16} /> {error}</div>}

        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner">
              <div className="spinner" />
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>HCP Name</th>
                  <th>Specialty</th>
                  <th>Country</th>
                  <th>Base Score</th>
                  <th>Bonus</th>
                  <th>Final Score</th>
                  <th>Tier</th>
                  <th>Assessed By</th>
                  <th>Date</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assessments.length > 0 ? (
                  assessments.map((a) => (
                    <tr
                      key={a.id}
                      className="clickable"
                      onClick={() => handleRowClick(a.id)}
                    >
                      <td className="font-mono">{a.id}</td>
                      <td>
                        <strong>{a.hcp_name || '--'}</strong>
                      </td>
                      <td>{a.specialty || '--'}</td>
                      <td>{a.country || '--'}</td>
                      <td>
                        {a.base_score != null
                          ? Number(a.base_score).toFixed(1)
                          : '--'}
                      </td>
                      <td>
                        {a.bonus_points != null
                          ? `+${Number(a.bonus_points).toFixed(1)}`
                          : '--'}
                      </td>
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
                        <div style={{ fontSize: '0.85rem' }}>{a.assessed_by_name || '--'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{a.assessed_by_email || ''}</div>
                      </td>
                      <td>
                        {a.created_at
                          ? new Date(a.created_at).toLocaleString()
                          : '--'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {deleteConfirm === a.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-danger" onClick={(e) => handleDelete(a.id, e)}>
                              Yes
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}>
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ color: 'var(--danger)' }}
                            title="Delete assessment"
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(a.id); }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="table-empty">
                      <p>No assessments found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="table-footer">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    className={p === page ? 'active' : ''}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
