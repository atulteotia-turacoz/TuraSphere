import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Cpu, Calculator } from 'lucide-react';
import { getHCP, scoreManual, scoreAutomated } from '../services/api';

export default function AssessmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [hcp, setHcp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // C.1 Leadership
  const [c1, setC1] = useState({
    board_member: false,
    advisory_board: false,
    professor: false,
    society_leader: false,
    executive_body: false
  });

  // C.2 Presentations
  const [c2, setC2] = useState({
    count: 0,
    level: 'domestic'
  });

  // C.3 Publications
  const [c3, setC3] = useState({
    count: 0,
    editorial_board: false,
    intl_journal: false,
    textbook_contributor: false
  });

  // C.4 Clinical
  const [c4, setC4] = useState({
    years_experience: 0,
    procedures_per_year: 0,
    unique_expertise: false
  });

  useEffect(() => {
    async function fetchHCP() {
      try {
        const res = await getHCP(id);
        setHcp(res.data);
        // Pre-fill from HCP data
        if (res.data.years_of_experience) {
          setC4(prev => ({ ...prev, years_experience: res.data.years_of_experience }));
        }
        if (res.data.procedures_per_year) {
          setC4(prev => ({ ...prev, procedures_per_year: res.data.procedures_per_year }));
        }
        if (res.data.unique_expertise) {
          setC4(prev => ({ ...prev, unique_expertise: true }));
        }
      } catch {
        setError('Failed to load HCP data.');
      } finally {
        setLoading(false);
      }
    }
    fetchHCP();
  }, [id]);

  const buildPayload = () => ({
    c1_leadership: c1,
    c2_presentations: {
      count: parseInt(c2.count) || 0,
      level: c2.level
    },
    c3_publications: {
      count: parseInt(c3.count) || 0,
      editorial_board: c3.editorial_board,
      intl_journal: c3.intl_journal,
      textbook_contributor: c3.textbook_contributor
    },
    c4_clinical: {
      years_experience: parseInt(c4.years_experience) || 0,
      procedures_per_year: parseInt(c4.procedures_per_year) || 0,
      unique_expertise: c4.unique_expertise
    }
  });

  const handleManualScore = async () => {
    setError('');
    setSubmitting(true);
    try {
      await scoreManual(id, buildPayload());
      navigate(`/hcp/${id}/results`);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Scoring failed.';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutomatedScore = async () => {
    setError('');
    setSubmitting(true);
    try {
      await scoreAutomated(id, buildPayload());
      navigate(`/hcp/${id}/results`);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Automated scoring failed.';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading assessment form...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page container">
      <div style={{ marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/hcp/${id}`)}>
          <ArrowLeft size={16} /> Back to Profile
        </button>
      </div>

      <div className="page-header">
        <h1 className="sr-only">KOL Assessment</h1>
        <p>Evaluating: <strong>{hcp?.full_name}</strong> - {hcp?.specialty}</p>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* C.1 Leadership & Recognition */}
      <div className="assessment-section">
        <div className="assessment-section-header">
          <span className="criterion-code">C.1</span>
          Leadership & Recognition
        </div>
        <div className="assessment-section-body">
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
            Select all leadership roles that apply to this HCP.
          </p>
          <div className="checkbox-group">
            {[
              { key: 'board_member', label: 'Board Member of a professional society' },
              { key: 'advisory_board', label: 'Advisory Board member for industry or government' },
              { key: 'professor', label: 'Full Professor at an academic institution' },
              { key: 'society_leader', label: 'Society Leader or committee chair' },
              { key: 'executive_body', label: 'Executive Body member of a medical organization' }
            ].map(item => (
              <label className="checkbox-label" key={item.key}>
                <input
                  type="checkbox"
                  checked={c1[item.key]}
                  onChange={(e) => setC1({ ...c1, [item.key]: e.target.checked })}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* C.2 Presentations */}
      <div className="assessment-section">
        <div className="assessment-section-header">
          <span className="criterion-code">C.2</span>
          Conference Presentations
        </div>
        <div className="assessment-section-body">
          <div className="form-row">
            <div className="form-group">
              <label>Number of Presentations (last 5 years)</label>
              <input
                type="number"
                value={c2.count}
                onChange={(e) => setC2({ ...c2, count: e.target.value })}
                min="0"
                placeholder="0"
              />
            </div>
            <div className="form-group">
              <label>Presentation Level</label>
              <div className="radio-group">
                {[
                  { value: 'domestic', label: 'Domestic' },
                  { value: 'international', label: 'International' },
                  { value: 'committee', label: 'Committee/Invited' }
                ].map(opt => (
                  <label key={opt.value} className={`radio-label ${c2.level === opt.value ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="c2_level"
                      value={opt.value}
                      checked={c2.level === opt.value}
                      onChange={(e) => setC2({ ...c2, level: e.target.value })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* C.3 Publications */}
      <div className="assessment-section">
        <div className="assessment-section-header">
          <span className="criterion-code">C.3</span>
          Publications & Research
        </div>
        <div className="assessment-section-body">
          <div className="form-group">
            <label>Number of Peer-Reviewed Publications</label>
            <input
              type="number"
              value={c3.count}
              onChange={(e) => setC3({ ...c3, count: e.target.value })}
              min="0"
              placeholder="0"
            />
          </div>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={c3.editorial_board}
                onChange={(e) => setC3({ ...c3, editorial_board: e.target.checked })}
              />
              Member of an editorial board
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={c3.intl_journal}
                onChange={(e) => setC3({ ...c3, intl_journal: e.target.checked })}
              />
              Published in international journals (high impact factor)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={c3.textbook_contributor}
                onChange={(e) => setC3({ ...c3, textbook_contributor: e.target.checked })}
              />
              Textbook contributor or author
            </label>
          </div>
        </div>
      </div>

      {/* C.4 Clinical */}
      <div className="assessment-section">
        <div className="assessment-section-header">
          <span className="criterion-code">C.4</span>
          Clinical Experience
        </div>
        <div className="assessment-section-body">
          <div className="form-row">
            <div className="form-group">
              <label>Years of Clinical Experience</label>
              <input
                type="number"
                value={c4.years_experience}
                onChange={(e) => setC4({ ...c4, years_experience: e.target.value })}
                min="0"
                placeholder="0"
              />
            </div>
            <div className="form-group">
              <label>Procedures per Year</label>
              <input
                type="number"
                value={c4.procedures_per_year}
                onChange={(e) => setC4({ ...c4, procedures_per_year: e.target.value })}
                min="0"
                placeholder="0"
              />
            </div>
          </div>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={c4.unique_expertise}
                onChange={(e) => setC4({ ...c4, unique_expertise: e.target.checked })}
              />
              Possesses unique or specialized clinical expertise
            </label>
          </div>
        </div>
      </div>

      {/* Submit Buttons */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '8px', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleManualScore}
          disabled={submitting}
        >
          {submitting ? (
            <><span className="spinner spinner-sm"></span> Scoring...</>
          ) : (
            <><Calculator size={18} /> Score (Manual Only)</>
          )}
        </button>
        <button
          className="btn btn-outline btn-lg"
          onClick={handleAutomatedScore}
          disabled={submitting}
        >
          {submitting ? (
            <><span className="spinner spinner-sm"></span> Analyzing...</>
          ) : (
            <><Cpu size={18} /> Score with Public Data (AI)</>
          )}
        </button>
      </div>
    </div>
  );
}
