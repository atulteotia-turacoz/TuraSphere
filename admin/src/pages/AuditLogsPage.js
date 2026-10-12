import React, { useState, useEffect, useCallback } from 'react';
import { getAuditLogs } from '../services/api';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAuditLogs({ page, limit: 25 });
      const data = res.data;
      setLogs(data?.logs || data || []);
      setTotalPages(data?.total_pages || 1);
    } catch (err) {
      console.error('Failed to fetch audit logs', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div>
      <div className="table-container">
        <div className="table-header">
          <h3>Audit Logs</h3>
        </div>

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
                  <th>Assessment ID</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>Performed By</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {logs.length > 0 ? (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td className="font-mono">{log.id}</td>
                      <td className="font-mono">
                        {log.assessment_id || '--'}
                      </td>
                      <td>
                        <span className="badge badge-info">
                          {log.action || '--'}
                        </span>
                      </td>
                      <td
                        className="truncate"
                        style={{ maxWidth: 300 }}
                        title={log.details || ''}
                      >
                        {log.details || '--'}
                      </td>
                      <td>{log.performed_by || log.user || '--'}</td>
                      <td>
                        {log.created_at || log.timestamp
                          ? new Date(
                              log.created_at || log.timestamp
                            ).toLocaleString()
                          : '--'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      <p>No audit logs found</p>
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
              {Array.from(
                { length: Math.min(totalPages, 7) },
                (_, i) => {
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
                }
              )}
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
