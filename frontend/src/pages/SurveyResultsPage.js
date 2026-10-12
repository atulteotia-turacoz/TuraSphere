import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Download, AlertCircle, BarChart3, Users, Calendar, Mail, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { getSurveyResults, deleteSurveyResponse } from '../services/api';
// Shared with the client portal's Survey Results tab — one CSV implementation.
import { formatAnswer, orderedAnswerKeys, downloadSurveyCsv } from '../utils/surveyCsv';

export default function SurveyResultsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'cards'

  const fetchData = async () => {
    try {
      const res = await getSurveyResults(id);
      setData(res.data);
    } catch { setError('Failed to load results'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleDeleteResponse = async (respId) => {
    if (!window.confirm('Delete this response?')) return;
    try { await deleteSurveyResponse(id, respId); await fetchData(); }
    catch { setError('Failed to delete response'); }
  };

  // Turn any value into one safe CSV field. Records are joined with CRLF (below), so we
  // normalize every in-cell break to a lone LF: Excel reads CRLF as "next row" but a
  // quoted LF as "next line inside the same cell". That keeps a full matrix grid — one
  // statement → answer per line — readable inside ONE cell instead of a run-on jumble,
  // and never spills across rows.
  const handleExportCSV = () => {
    downloadSurveyCsv(data, `${data?.title || 'survey'}_results.csv`);
  };

  if (loading) {
    return <div className="page container"><div className="loading-container"><div className="spinner"></div><p>Loading results...</p></div></div>;
  }

  const questionKeys = data?.responses.length > 0
    ? orderedAnswerKeys(data)
    : [];

  const introKeys = data?.responses.length > 0
    ? [...new Set(data.responses.filter(r => r.intro_data).flatMap(r => Object.keys(r.intro_data)))]
    : [];

  return (
    <div className="page container">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/surveys')} style={{ padding: 8 }}><ArrowLeft size={18} /></button>
          <div>
            <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{data?.title || 'Survey'}</h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', margin: 0 }}>
              Survey Results
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {data?.responses.length > 0 && (
            <>
              <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <button onClick={() => setViewMode('table')}
                  style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                    background: viewMode === 'table' ? 'var(--color-primary)' : 'var(--color-white)',
                    color: viewMode === 'table' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>
                  Table
                </button>
                <button onClick={() => setViewMode('cards')}
                  style={{ padding: '6px 12px', border: 'none', borderLeft: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                    background: viewMode === 'cards' ? 'var(--color-primary)' : 'var(--color-white)',
                    color: viewMode === 'cards' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>
                  Cards
                </button>
              </div>
              <button className="btn btn-primary" onClick={handleExportCSV}>
                <Download size={15} /> Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>
      )}

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-icon primary"><Users size={20} /></div>
          <div className="stat-label">Total Responses</div>
          <div className="stat-value">{data?.total_responses || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon info"><FileText size={20} /></div>
          <div className="stat-label">Questions</div>
          <div className="stat-value">{questionKeys.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success"><Calendar size={20} /></div>
          <div className="stat-label">Latest Response</div>
          <div className="stat-value" style={{ fontSize: '1rem' }}>
            {data?.responses.length > 0
              ? new Date(data.responses[0].submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : '--'}
          </div>
        </div>
      </div>

      {/* No responses */}
      {!data?.responses.length ? (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <BarChart3 size={28} style={{ color: 'var(--color-info)' }} />
          </div>
          <h3 style={{ marginBottom: 6 }}>No Responses Yet</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 16 }}>Share your survey link to start collecting responses.</p>
          <button className="btn btn-outline" onClick={() => navigate(`/surveys/${id}/edit`)}>
            <ArrowLeft size={14} /> Back to Editor
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        /* ════ CARD VIEW ════ */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.responses.map((r, idx) => (
            <div key={r.id} className="card" style={{ overflow: 'hidden' }}>
              {/* Card header */}
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-primary-bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                    {idx + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.respondent_name || 'Anonymous'}
                      {r.status === 'partial' && (
                        <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: 999, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', fontWeight: 600, letterSpacing: '0.02em' }}>
                          Partial
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.respondent_email && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Mail size={11} /> {r.respondent_email}</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Calendar size={11} /> {new Date(r.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); handleDeleteResponse(r.id); }}
                    style={{ color: 'var(--color-text-light)' }} title="Delete"
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                    <Trash2 size={14} />
                  </button>
                  {expandedRow === r.id ? <ChevronUp size={16} style={{ color: 'var(--color-text-light)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-text-light)' }} />}
                </div>
              </div>

              {/* Expanded answers */}
              {expandedRow === r.id && (
                <div style={{ padding: '16px 20px' }}>
                  {/* Intro data */}
                  {r.intro_data && Object.keys(r.intro_data).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>
                        Introduction
                      </div>
                      {Object.entries(r.intro_data).map(([key, val]) => (
                        <div key={key} style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: '0.88rem' }}>
                          <span style={{ color: 'var(--color-text-secondary)', minWidth: 120, fontWeight: 500 }}>{key}</span>
                          <span style={{ color: 'var(--color-text)' }}>{val || '--'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Answers */}
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>
                    Answers
                  </div>
                  {questionKeys.map((key, i) => (
                    <div key={i} style={{ padding: '8px 0', borderBottom: i < questionKeys.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2 }}>
                        Q{i + 1}. {key}
                      </div>
                      <div style={{ fontSize: '0.92rem', color: 'var(--color-text)' }}>
                        {r.answers[key] ? formatAnswer(r.answers[key]) : <span style={{ color: 'var(--color-text-light)' }}>--</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ════ TABLE VIEW ════ */
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-striped">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Name</th>
                  <th>Email</th>
                  {introKeys.map((k, i) => (
                    <th key={`intro_${i}`} style={{ maxWidth: 160 }} title={k}>{k}</th>
                  ))}
                  {questionKeys.map((k, i) => (
                    <th key={i} style={{ maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={k}>{k}</th>
                  ))}
                  <th>Submitted</th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.responses.map((r, idx) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '0.85rem' }}>{idx + 1}</td>
                    <td style={{ fontWeight: 500 }}>
                      {r.respondent_name || <span style={{ color: 'var(--color-text-light)' }}>--</span>}
                      {r.status === 'partial' && (
                        <span style={{ marginLeft: 6, fontSize: '0.65rem', padding: '1px 6px', borderRadius: 999, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', fontWeight: 600 }}>
                          Partial
                        </span>
                      )}
                    </td>
                    <td>{r.respondent_email || <span style={{ color: 'var(--color-text-light)' }}>--</span>}</td>
                    {introKeys.map((k, i) => (
                      <td key={`intro_${i}`} style={{ maxWidth: 160 }} title={r.intro_data?.[k] || ''}>
                        {r.intro_data?.[k] || <span style={{ color: 'var(--color-text-light)' }}>--</span>}
                      </td>
                    ))}
                    {questionKeys.map((k, i) => (
                      <td key={i} style={{ maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={formatAnswer(r.answers[k] || '')}>
                        {r.answers[k] ? formatAnswer(r.answers[k]) : <span style={{ color: 'var(--color-text-light)' }}>--</span>}
                      </td>
                    ))}
                    <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                      {new Date(r.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleDeleteResponse(r.id)}
                        style={{ color: 'var(--color-text-light)', padding: 4 }} title="Delete response"
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
