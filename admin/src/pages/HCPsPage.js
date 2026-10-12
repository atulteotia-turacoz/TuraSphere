import React, { useState, useEffect, useCallback } from 'react';
import { Search, Eye, X, Trash2, Check, AlertTriangle } from 'lucide-react';
import { listHCPs, getHCP, deleteHCP } from '../services/api';

export default function HCPsPage() {
  const [hcps, setHcps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedHCP, setSelectedHCP] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const fetchHCPs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listHCPs({ search: search || undefined, limit: 100 });
      const data = res.data;
      setHcps(Array.isArray(data) ? data : data?.items || []);
    } catch (err) {
      console.error('Failed to fetch HCPs', err);
      setError('Failed to load HCP profiles');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchHCPs();
  }, [fetchHCPs]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const viewDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await getHCP(id);
      setSelectedHCP(res.data);
    } catch (err) {
      console.error('Failed to fetch HCP detail', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteHCP(id);
      setSuccess('HCP profile deleted successfully');
      setDeleteConfirm(null);
      fetchHCPs();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete HCP');
      setDeleteConfirm(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      <div className="table-container">
        <div className="table-header">
          <h3>HCP Profiles ({hcps.length})</h3>
          <div className="table-actions">
            <div className="table-search">
              <Search className="search-icon" size={16} />
              <input
                type="text"
                placeholder="Search by name, specialty, country..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {success && <div className="alert alert-success" style={{ margin: '0 16px 12px' }}><Check size={16} /> {success}</div>}
        {error && <div className="alert alert-error" style={{ margin: '0 16px 12px' }}><AlertTriangle size={16} /> {error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Specialty</th>
                <th>Country</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Created</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {hcps.length > 0 ? (
                hcps.map((hcp) => (
                  <tr key={hcp.id}>
                    <td className="font-mono">{hcp.id}</td>
                    <td>
                      <strong>{hcp.full_name || '--'}</strong>
                    </td>
                    <td>{hcp.specialty || '--'}</td>
                    <td>{hcp.country || '--'}</td>
                    <td>
                      <span className={`badge ${hcp.status === 'assessed' ? 'badge-success' : hcp.status === 'submitted' ? 'badge-warning' : 'badge-secondary'}`}>
                        {hcp.status || 'draft'}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.85rem' }}>
                        {hcp.user_name || '--'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {hcp.user_email || ''}
                      </div>
                    </td>
                    <td>
                      {hcp.created_at
                        ? new Date(hcp.created_at).toLocaleString()
                        : '--'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn-icon"
                          title="View details"
                          onClick={() => viewDetail(hcp.id)}
                        >
                          <Eye size={16} />
                        </button>
                        {deleteConfirm === hcp.id ? (
                          <>
                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(hcp.id)}>Yes</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setDeleteConfirm(null)}>No</button>
                          </>
                        ) : (
                          <button
                            className="btn-icon"
                            title="Delete HCP"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => setDeleteConfirm(hcp.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <p>No HCP profiles found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* HCP Detail Modal */}
      {selectedHCP && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedHCP(null)}
        >
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                {selectedHCP.full_name || selectedHCP.name || 'HCP Detail'}
              </h3>
              <button
                className="modal-close"
                onClick={() => setSelectedHCP(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {detailLoading ? (
                <div className="loading-spinner">
                  <div className="spinner" />
                </div>
              ) : (
                <div className="detail-grid three-col">
                  <div className="detail-item">
                    <label>Full Name</label>
                    <div className="detail-value">
                      {selectedHCP.full_name || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Email</label>
                    <div className="detail-value">
                      {selectedHCP.email || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Specialty</label>
                    <div className="detail-value">
                      {selectedHCP.specialty || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Country</label>
                    <div className="detail-value">
                      {selectedHCP.country || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Institution</label>
                    <div className="detail-value">
                      {selectedHCP.institution || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>HCP Type</label>
                    <div className="detail-value">
                      {selectedHCP.hcp_type || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Education</label>
                    <div className="detail-value">
                      {selectedHCP.education || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Years of Experience</label>
                    <div className="detail-value">
                      {selectedHCP.years_of_experience ?? '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Status</label>
                    <div className="detail-value">
                      {selectedHCP.status || '--'}
                    </div>
                  </div>
                  <div className="detail-item">
                    <label>Created</label>
                    <div className="detail-value">
                      {selectedHCP.created_at
                        ? new Date(selectedHCP.created_at).toLocaleString()
                        : '--'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
