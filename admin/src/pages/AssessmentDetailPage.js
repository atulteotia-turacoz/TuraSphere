import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  ArrowLeft,
  Download,
  Trash2,
  Cpu,
  Database,
  FlaskConical,
  BookOpen,
  Stethoscope,
} from 'lucide-react';
import { getAssessment, deleteAssessment } from '../services/api';

const BAR_COLORS = [
  'var(--primary)', 'var(--tier-platinum)', 'var(--info)', 'var(--tier-bronze)', 'var(--success)',
  'var(--warning)', 'var(--danger)', 'var(--tier-gold)', 'var(--primary)', 'var(--tier-bronze)',
  'var(--warning)', 'var(--tier-platinum)', 'var(--tier-bronze)', 'var(--success)', 'var(--danger)',
];

const SOURCE_CONFIG = {
  cv: { label: 'CV / AI', icon: Cpu, color: 'var(--primary)' },
  pubmed: { label: 'PubMed', icon: Database, color: 'var(--success)' },
  clinical_trials: { label: 'ClinicalTrials.gov', icon: FlaskConical, color: 'var(--warning)' },
  google_scholar: { label: 'Google Scholar', icon: BookOpen, color: 'var(--tier-platinum)' },
  practo: { label: 'Practo', icon: Stethoscope, color: 'var(--tier-gold)' },
};

function SourceTag({ source }) {
  const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.cv;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '0.7rem', padding: '2px 7px', borderRadius: 10,
      background: `${cfg.color}12`, color: cfg.color, fontWeight: 500,
    }}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

export default function AssessmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchAssessment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchAssessment = async () => {
    try {
      const res = await getAssessment(id);
      setAssessment(res.data);
    } catch (err) {
      setError('Failed to load assessment.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!assessment) return;
    const blob = new Blob([JSON.stringify(assessment, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assessment_${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

  if (!assessment) return null;

  const hasParamScores = assessment.parameter_scores && assessment.parameter_scores.length > 0;

  // Group parameter scores by category
  const categoryGroups = {};
  if (hasParamScores) {
    assessment.parameter_scores.forEach((ps) => {
      if (!categoryGroups[ps.parameter_category]) {
        categoryGroups[ps.parameter_category] = [];
      }
      categoryGroups[ps.parameter_category].push(ps);
    });
  }

  const chartData = hasParamScores
    ? assessment.parameter_scores.map((ps) => ({
        name: ps.parameter_code,
        score: ps.score,
        max: ps.max_score,
        fullName: ps.parameter_name,
      }))
    : [];

  const maxPossible = hasParamScores
    ? assessment.parameter_scores.reduce((sum, ps) => sum + ps.max_score, 0)
    : 55;

  return (
    <div>
      {/* Header */}
      <div className="detail-header">
        <Link to="/assessments" className="back-link">
          <ArrowLeft size={18} />
          Back to Assessments
        </Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={handleExport}>
            <Download size={16} />
            Export JSON
          </button>
          {deleteConfirm ? (
            <>
              <button
                className="btn btn-danger btn-sm"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteAssessment(id);
                    navigate('/assessments');
                  } catch (err) {
                    setError(err.response?.data?.detail || 'Failed to delete');
                    setDeleteConfirm(false);
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger-light)' }} onClick={() => setDeleteConfirm(true)}>
              <Trash2 size={16} />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* HCP Info */}
      <div className="card mb-6">
        <div className="card-header">
          <h3>HCP Information</h3>
          <span className={`badge badge-tier-${(assessment.tier || '').toLowerCase()}`}>
            {assessment.tier ? assessment.tier.replace(/_/g, ' ') : '--'}
          </span>
        </div>
        <div className="card-body">
          <div className="detail-grid three-col">
            <div className="detail-item">
              <label>Name</label>
              <div className="detail-value">{assessment.hcp_name || '--'}</div>
            </div>
            <div className="detail-item">
              <label>Specialty</label>
              <div className="detail-value">{assessment.specialty || '--'}</div>
            </div>
            <div className="detail-item">
              <label>Country</label>
              <div className="detail-value">{assessment.country || '--'}</div>
            </div>
            <div className="detail-item">
              <label>Institution</label>
              <div className="detail-value">{assessment.institution || '--'}</div>
            </div>
            <div className="detail-item">
              <label>Final Score</label>
              <div className="detail-value" style={{ fontSize: '1.25rem' }}>
                {assessment.final_score != null ? Number(assessment.final_score).toFixed(1) : '--'}
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}> / {maxPossible}</span>
              </div>
            </div>
            <div className="detail-item">
              <label>Parameters Scored</label>
              <div className="detail-value">
                {hasParamScores ? assessment.parameter_scores.length : '--'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Score Breakdown Chart */}
      {hasParamScores && (
        <div className="card mb-6">
          <div className="card-header">
            <h3>Score Breakdown</h3>
          </div>
          <div className="card-body">
            <div className="chart-wrapper" style={{ height: Math.max(350, chartData.length * 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value, name, props) => [
                      `${Number(value).toFixed(1)} / ${props.payload.max}`,
                      props.payload.fullName,
                    ]}
                  />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    {chartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Parameter Scores */}
      {hasParamScores && (
        <div className="card mb-6">
          <div className="card-header">
            <h3>Detailed Parameter Scores</h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {Object.entries(categoryGroups).map(([category, scores]) => (
              <div key={category}>
                <div style={{
                  padding: '10px 16px', background: 'var(--content-bg)',
                  fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-color)',
                }}>
                  {category}
                  <span style={{ float: 'right', fontWeight: 400 }}>
                    {scores.reduce((s, p) => s + p.score, 0).toFixed(1)} / {scores.reduce((s, p) => s + p.max_score, 0)}
                  </span>
                </div>
                <div className="table-wrapper">
                  <table>
                    <tbody>
                      {scores.map((ps) => (
                        <tr key={ps.parameter_id}>
                          <td style={{ width: '30%', fontWeight: 500 }}>
                            <div>{ps.parameter_name}</div>
                            {ps.scoring_source && <SourceTag source={ps.scoring_source} />}
                          </td>
                          <td style={{ width: '15%' }}>
                            <strong>{ps.score.toFixed(1)}</strong>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}> / {ps.max_score}</span>
                          </td>
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {ps.justification}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Justification / AI Summary */}
      {assessment.justification && (
        <div className="card mb-6">
          <div className="card-header">
            <h3>AI Summary</h3>
          </div>
          <div className="card-body">
            <p style={{ lineHeight: 1.7, color: 'var(--text-secondary)' }}>{assessment.justification}</p>
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="card">
        <div className="card-header">
          <h3>Metadata</h3>
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Assessment ID</label>
              <div className="detail-value font-mono">{assessment.id}</div>
            </div>
            <div className="detail-item">
              <label>HCP ID</label>
              <div className="detail-value font-mono">{assessment.hcp_id || '--'}</div>
            </div>
            <div className="detail-item">
              <label>Created At</label>
              <div className="detail-value">
                {assessment.created_at ? new Date(assessment.created_at).toLocaleString() : '--'}
              </div>
            </div>
            <div className="detail-item">
              <label>Assessed By</label>
              <div className="detail-value">{assessment.assessed_by || '--'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
